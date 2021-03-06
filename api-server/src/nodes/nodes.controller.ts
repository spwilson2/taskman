import * as assert from 'assert';
import * as express from 'express';
import * as httpStatus from 'http-status-codes';
import { once, EventEmitter } from "events";
//import Node from './node.interface';
//

class TemplateContainsId extends Error {}
class TemplateMissingMetadata extends Error {}
class TemplateMissingMetadataAttribute extends Error {
    public attribute: string;
    constructor(attribute: string) {
        super(`Missing metadata attribute "${attribute}".`);
        this.attribute = attribute;
    }

}

// This error represents a programming error, not a user validation problem.
class MissingMetadataAttributeError extends Error {
    public attribute: string;
    constructor(attribute: string) {
        super(`Missing metadata attribute "${attribute}".`);
        this.attribute = attribute;
    }
}
class MissingMetadataError extends Error {}

/**
 * This class contains required metadata for NodeTemplate objects.
 * (Node objects can contain extra metadata, this defines a subset.)
 */
class NodeTemplateMetadata {
    public type: string;
    public parent: string;

    /**
     * Attempt to interpret the given object as a NodeTemplateMetadata object.
     *
     * If the object is missing required attributes a TemplateMissingMetadataAttribute
     * Error will be thrown.
     */
    public static checkedInterpretObject(o : object) {
        for (const a of ['type', 'parent']) {
            if (!(a in o)) {
                throw new TemplateMissingMetadataAttribute(`${a}`);
            }
        }
        if ('id' in o) {
            throw new TemplateContainsId();
        }
        return o as NodeMetadata;
    }

    private constructor() {}
}

/**
 * NodeTemplate objects are prototype - think incomplete - versions of Node
 * objects. They are submitted by users as requests to create full fledged
 * Nodes.
 */
class NodeTemplate {
    metadata: NodeTemplateMetadata;
    data: object;

    public static checkedInterpretObject(o : object) {
        if (!('metadata' in o)) {
            throw new TemplateMissingMetadata();
        }

        // Ignore return value, just forward exception
        NodeTemplateMetadata.checkedInterpretObject(o['metadata']);
        return o as NodeTemplate;
    }
}

/**
 * This class contains required metadata for Node objects.
 * (Node objects can contain extra metadata, this defines a subset.)
 */
class NodeMetadata {
    public id : string;
    public type: string;
    public parent: string;
    public state: NodeState;

    public static fromObject(o : object) {
        let us = NodeMetadata.fromArgs(o['id'], o['type'], o['parent']);
        Object.assign(o, us);
        return us;
    }
    public static fromArgs(id :string, type : string, parent: string) {
        let us = new this();
        us.id = id;
        us.parent = parent;
        us.type = type;
        return us;
    }

    public static checkedInterpretObject(o : object) {
        for (const a of ['id', 'type', 'parent']) {
            if (!(a in o)) {
                throw new MissingMetadataAttributeError(`${a}`);
            }
        }
        return o as NodeMetadata;
    }

    public static interpretObject(o : object) {
        //ifdef DEBUG
        return NodeMetadata.checkedInterpretObject(o);
        //endif DEBUG
        //return o as NodeMetadata;
    }

    private constructor() {}
}

class Node {
    metadata: NodeMetadata;
    data: object;

    public static checkedInterpretObject(o : object) {
        if (!('metadata' in o)) {
            throw new MissingMetadataError();
        }

        // Ignore return value, just forward exception
        NodeMetadata.checkedInterpretObject(o['metadata']);
        return o as Node;
    }

    public static interpretObject(o : object) {
        // ifdef DEBUG
        return Node.checkedInterpretObject(o);
        // endif DEBUG
        //return o as Node;
    }
}

class NodeCounter {
    private static INITIAL = 0;
    private curIdx: number = NodeCounter.INITIAL;

    constructor() {
    }

    /** @returns: The highest number output so far or -1. */
    public highest() {
        return this.curIdx - 1;
    }
    public wasGenerated(val: number) {
        return val <= this.highest() && val >= NodeCounter.INITIAL;
    }

    public next() {
        return this.curIdx++;
    }
}

enum NodeState {
    Killing = "killing",
}

class NodesController {
    public path = '/nodes';
    public router = express.Router();

    // TODO Eventually this should be transitioned into a database, for now we
    // just store a global table.

    private idGenerator: NodeCounter;
    private nodes: Node[];

    constructor() {
        this.idGenerator = new NodeCounter();
        this.nodes = [];
        this.initializeRoutes()
    }

    public initializeRoutes() {
        this.handleGetNodes = this.handleGetNodes.bind(this);
        this.router.get(this.path, this.handleGetNodes);

        this.handlePostNodes = this.handlePostNodes.bind(this);
        this.router.post(this.path, this.handlePostNodes);

        // TODO These endpoints should be moved to a separate file?
        this.handleGetIdDataKey = this.handleGetIdDataKey.bind(this);
        this.router.get(this.path + '/:id/data/:key', this.handleGetIdDataKey);

        this.handlePutIdDataKey = this.handlePutIdDataKey.bind(this);
        this.router.put(this.path + '/:id/data/:key', this.handlePutIdDataKey);

        this.handleGetIdData = this.handleGetIdData.bind(this);
        this.router.get(this.path + '/:id/data', this.handleGetIdData);



        // TODO Split out into separate controller
        this.nodeStateEmitter = new EventEmitter();

        this.handlePutSchedulerKill = this.handlePutSchedulerKill.bind(this);
        this.router.put('/scheduler/kill', this.handlePutSchedulerKill);

        this.handleGetSchedulerWait = this.handleGetSchedulerWait.bind(this);
        this.router.get('/scheduler/wait', this.handleGetSchedulerWait);

        this.handlePatchSchedulerState = this.handlePatchSchedulerState.bind(this);
        this.router.patch('/scheduler/state', this.handlePatchSchedulerState);
    }

    other = (request: express.Request, response: express.Response) => {
        response.send('Hello World');
    }

    private filterNodes<T>(list: T[], callback: (node: T) => boolean) {
        // I don't know how javacript stores Array's, if they're linked lists this
        // method of deletion is certainly faster, if not it might just be faster to
        // rebuild the Array with normal filter.
        let del_list : Array<number> = [];
        for (let i = 0; i < list.length; i++) {
            if (!callback(list[i])) {
                del_list.push(i);
            }
        }
        for (let i = list.length - 1; i >= 0; i--) {
            list.splice(i, 0);
        }
    }

    private getNode(id: number) {
        for (const n of this.nodes) {
            if (Number(n.metadata.id) === id) {
                return n;
            }
        }
        return null;
    }


    private verifyParameters(allowed: Set<string>, req: express.Request, res: express.Response) {
        // Check for unexpected parameters and log them.
        for (const k of Object.keys(req.query)) {
            if (!allowed.has(k)) {
                console.log(`Router '${this.path}' - Recieved packet with unsupported parameter ${k}`);
                res.status(httpStatus.BAD_REQUEST).send(`Unsupported parameter "${k}"`);
                return false;
            }
        }
        return true;
    }
    /**
     *
     * /nodes - GET - Get high level information about many nodes at once
     *
     * Parameters:
     * - (o) type - Type of nodes ids to return
     * - (o) state - Status of node ids to return, if not supplied nodes of all
     *   state types will be returned
     * - (o) metadata - Comma separated list of metadata to provide with the nodes,
     *   (in addition to ID) if not supplied, all metadata will be returned
     * - (o) new=<id> - Return only nodes newer than the given id, if none are newer
     *   the request will wait until the client times out or one or more nodes are
     *   added
     *
     */
    private handleGetNodes(request: express.Request, response: express.Response) {
        const supported_args = new Set(["type", "state", "metadata", "new"]);
        if (!this.verifyParameters(supported_args, request, response))
            return;

        // Create a response object with just the node's metadata
        let nodes : NodeMetadata[] = [];
        for (const n of this.nodes) {
            nodes.push(NodeMetadata.fromObject(n.metadata))
        }

        if ("type" in request.query) {
            // Split the type paramaeter by commas
            let types =  new Set(request.query.split(','));
            this.filterNodes<NodeMetadata>(nodes, (node: NodeMetadata) => {
                return types.size == 0 || node["type"] in types;
            })
        }
        if ("state" in request.query) {
            // Split the type paramaeter by commas
            let states =  new Set(request.query.split(','));
            this.filterNodes(nodes, (node: NodeMetadata) => {
                return states.size == 0 || node["state"] in states;
            })
        }

        // Filter out nodes by ID's (newer than)
        if ("new" in request.query) {
            let req = request.query["new"];
            let limit : number = Number(req);
            if (isNaN(limit)) {
                console.log("Router '%s' - Recieved packet with new parameter '%s' this is NaN.", this.path, limit);
                response.status(httpStatus.BAD_REQUEST).send(`Requested new param "${req}" is NaN.`);
                return;
            }

            // Look through each node, only return nodes whose id is > new
            this.filterNodes(nodes, (n: NodeMetadata) => {
                return Number(n["id"]) > limit;
            })
        }

        // Filter out metadata options to only those requested
        if ("metadata" in request.query) {
            let metadata = request.query.get("metadata").split(',');
            // For each node, filter their metadata attributes
            for (let n of nodes) {
                let new_map = {};
                for (let [k, v] of Object.keys(n)) {
                    if (!(k in metadata)) {
                        delete n[k];
                    }
                }
            }
        }

        // TODO Pagination
        response.send(nodes);
    }
    
    private addTemplatedNode(node_request: NodeTemplate) {
        let new_id = this.idGenerator.next();
        node_request['metadata']['id'] = new_id;
        this.nodes.push(Node.interpretObject(node_request));
    }

    /**
     *
     *
     * /nodes - POST - Add a new node with given metadata & data
     *
     * Node should be formatted as follows (multiple can be submitted at the same time)::
     *     [
     *         {
     *             metadata: {
     *                 type: "<any-supported-type>",
     *                 parent: "<root | an existing node ID>"
     *                 // An ID will be automatically generated by the server
     *                 // The task will automatically be place in the incipient state
     *             }
     *             data: {
     *             }
     *         } //, Optional additional nodes
     *     ]
     * */
    private handlePostNodes(request: express.Request, response: express.Response) {
        if (!this.verifyParameters(new Set(), request, response))
            return;

        if (!(request.body instanceof Array)) {
            response.status(httpStatus.BAD_REQUEST).send("POST data did not contain Array as top-level");
            return;
        }
        for (const n of request.body) {
            try {
                if (!('data' in n)) {
                    n.data = {}
                }

                // Ignore return val, just check exception
                NodeTemplate.checkedInterpretObject(n);
            } catch (e) {
                response.status(httpStatus.BAD_REQUEST).send(e.message);
                return;
            }
        }
        let node_requests: NodeTemplate[] = request.body;
        for (const n of node_requests) {
            this.addTemplatedNode(n);
        }
        response.send();
    }

    /**
     *
     * /nodes/<id>/data - GET - Returns a list of data keys
     *
     * Response format::
     *     {
     *         keys: [
     *             "a", "list", "of", "keys" 
     *         ]
     *     }
     *
     * Pagination is supported for this interface.
     *
     */
    private handleGetIdData(req: express.Request, res: express.Response) {
        if (!this.verifyParameters(new Set(), req, res))
            return;

        let idx = Number(req.params.id);
        if (isNaN(idx) || !(this.idGenerator.wasGenerated(idx))) {
            res.status(httpStatus.NOT_FOUND).send(`ID "${req.params.id}" does not exist`);
            return;
        }

        const node = this.nodes[idx];
        assert.ok(Number(node.metadata.id) == idx);
        res.send(Object.keys(node.data));
    }

    /**
     *
     * /nodes/<id>/data/<key> - GET - Returns data for the given key
     *
     * Pagination is supported for this interface.
     *
     * Response format::
     *     
     *     {
     *         key: "<key>",
     *         data: "<data>",
     *         pagination: {
     *             next: "<value-to-use-in-next-request>",
     *             pid: "<value-to-use-in-next-request>"
     *         }
     *     }
     * */
    private handleGetIdDataKey(req: express.Request, res: express.Response) {
        if (!this.verifyParameters(new Set(), req, res))
            return;

        let idx = Number(req.params.id);
        if (isNaN(idx) || !(this.idGenerator.wasGenerated(idx))) {
            res.status(httpStatus.NOT_FOUND).send(`ID "${req.params.id}" does not exist`);
            return;
        }

        const node = this.nodes[idx];
        assert.ok(Number(node.metadata.id) == idx);

        if (!(req.params.key in node.data)) {
            res.status(httpStatus.NOT_FOUND).send(`Key "${req.params.key}" does not exist`);
            return;
        }

        res.send({
            "key": req.params.key,
            "data": node.data[req.params.key],
            // TODO Pagination
        });
    }

    /**
     *
     * /nodes/<id>/data/<key> - PUT - Replace data values
     *
     * Expected request format::
     *
     *  {
     *      value: "<data>",
     *  }
     *
     * Pagination is supported for this interface, however it is a bit special.
     * The ``start`` parameter is optional. If it is provided but without
     * a value then PUT will only replace the current value if the value for
     * ``<key>`` is unset.  The ``pagid`` value and ``start`` value to replace
     * the first slot of data will be returned in the response. Otherwise,
     * pagination behaves as you would expect.
     * */
    private handlePutIdDataKey(req: express.Request, res: express.Response) {
        if (!this.verifyParameters(new Set(), req, res))
            return;

        let idx = Number(req.params.id);
        if (isNaN(idx) || !(this.idGenerator.wasGenerated(idx))) {
            res.status(httpStatus.NOT_FOUND).send(`ID "${req.params.id}" does not exist`);
            return;
        }

        let node = this.nodes[idx];
        assert.ok(Number(node.metadata.id) == idx);

        if (!('value' in req.body) || (req.body.size > 1)) {
            res.status(httpStatus.BAD_REQUEST).send(`Data formatted incorrectly.`);
            return;
        }
        node.data[req.params.key] = req.body['value'];
        res.send();
        //TODO Pagination
    }


    private nodeStateEmitter : EventEmitter;

    private nodeStateEmitterEvent(id: number, state: NodeState) {
        return `${id}:${state}`;
    }

    private nodeSetState(node : Node, state: NodeState) {
        // Set the node's state
        node.metadata.state = state;
        const key = this.nodeStateEmitterEvent(Number(node.metadata.id), state);

        // Wake up all callbacks waiting for the node state to change
        this.nodeStateEmitter.emit(key);
    }

    private async waitNodeUpdate(id: number, state: NodeState) {
        const key = this.nodeStateEmitterEvent(id, state);
        await once(this.nodeStateEmitter, key);
    }

    // Scheduler functions should use an accessor to get node data/information.
    // Callbacks should be able to then be informed when state changes occur.
    private async handleGetSchedulerWait(req: express.Request, res: express.Response) {
        if (!this.verifyParameters(new Set(["id", "state"]), req, res))
            return;
        if (!("id" in req.query)) {
            res.status(httpStatus.BAD_REQUEST).send("Missing id query parameter.");
            return;
        }
        if (!("state" in req.query)) {
            res.status(httpStatus.BAD_REQUEST).send("Missing state query parameter.");
            return;
        }

        let node_ids : any[] = req.query.id.split(',');
        let state = req.query["state"];
        // Verify all node_ids are numbers
        for (const n of node_ids) {
            let id = Number(n);
            if (isNaN(id) || !this.idGenerator.wasGenerated(id)) {
                res.status(httpStatus.BAD_REQUEST).send(`Provided id "${n}" is not valid.`);
                return;
            }
        }
        node_ids = node_ids.map(Number);

        if (!Object.values(NodeState).includes(state)) {
                res.status(httpStatus.BAD_REQUEST).send(`Provided state "${state}" is not valid.`);
            return;
        }

        // Get the node with given id
        for (const n of node_ids) {
            let node = this.getNode(n);
            if (node.metadata.state !== state)
                await this.waitNodeUpdate(n, state);
        }

        res.send({'ids': node_ids.map(String), "state": req.query["state"]});
    }

    private handlePutSchedulerKill(req: express.Request, res: express.Response) {
        if (!this.verifyParameters(new Set(["id"]), req, res))
            return;
        if (!("id" in req.query)) {
            res.status(httpStatus.BAD_REQUEST).send("Missing id query parameter.");
            return;
        }

        let node_ids = req.query.id.split(',');
        // Verify all node_ids are numbers
        for (const n of node_ids) {
            let id = Number(n);
            if (isNaN(id) || !this.idGenerator.wasGenerated(id)) {
                res.status(httpStatus.BAD_REQUEST).send(`Provided id "${n}" is not valid.`);
                return;
            }
        }
        node_ids = node_ids.map(Number);

        for (const n of node_ids) {
            let node = this.getNode(n);
            this.nodeSetState(node, NodeState.Killing);
        }

        res.send();
    }

    /**
     *  /scheduler/state - PATCH - Mark the task as started updating the state to
     *  ``<state>``
     *
     *  Parameters:
     *  - id - Comma separated list of tasks to mark with given state
     *  - state - State to set the task(s) to
     */
    private handlePatchSchedulerState(req: express.Request, res: express.Response) {
        if (!this.verifyParameters(new Set(["id", "state"]), req, res))
            return;
        if (!("state" in req.query)) {
            res.status(httpStatus.BAD_REQUEST).send("Missing state query parameter.");
            return;
        }
        let state = req.query.state;
        if (!Object.values(NodeState).includes(state)) {
                res.status(httpStatus.BAD_REQUEST).send(`Provided state "${state}" is not valid.`);
            return;
        }
        if (!("id" in req.query)) {
            res.status(httpStatus.BAD_REQUEST).send("Missing id query parameter.");
            return;
        }
        let node_ids = req.query.id.split(',');
        // Verify all node_ids are numbers
        for (const n of node_ids) {
            let id = Number(n);
            if (isNaN(id) || !this.idGenerator.wasGenerated(id)) {
                res.status(httpStatus.BAD_REQUEST).send(`Provided id "${n}" is not valid.`);
                return;
            }
        }
        node_ids = node_ids.map(Number);
        for (const id of node_ids) {
            let node = this.getNode(id);
            this.nodeSetState(node, state);
        }

        res.send({"ids": node_ids.map(String), "state": state});
    }
}

export default NodesController;