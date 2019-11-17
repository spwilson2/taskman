import * as express from 'express';
import * as httpStatus from 'http-status-codes';
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
    data?: object;

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
    data?: object;

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
    private curIdx: number;

    constructor() {
        this.curIdx = 0;
    }

    public next() {
        return this.curIdx++;
    }
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
    }

    other = (request: express.Request, response: express.Response) => {
        response.send('Hello World');
    }

    private filterNodes(list: Node[], callback: (node: Node) => boolean) {
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

        // Check for unexpected parameters and log them.
        for (const k of Object.keys(request.query)) {
            if (!supported_args.has(k)) {
                console.log(`Router '${this.path}' - Recieved packet with unsupported parameter ${k}`);
                response.status(httpStatus.BAD_REQUEST).send(`Unsupported parameter "${k}"`);
                return;
            }
        }
        // Create a response object with just the node's metadata
        let nodes : Node[] = [];
        for (const n of this.nodes) {
            nodes.push({
                "metadata": NodeMetadata.fromObject(n.metadata),
            })
        }

        if ("type" in request.query) {
            // Split the type paramaeter by commas
            let types =  new Set(request.query.split(','));
            this.filterNodes(nodes, (node: Node) => {
                return types.size == 0 || node["type"] in types;
            })
        }
        if ("state" in request.query) {
            // Split the type paramaeter by commas
            let states =  new Set(request.query.split(','));
            this.filterNodes(nodes, (node: Node) => {
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
            this.filterNodes(nodes, (n: Node) => {
                return Number(n.metadata["id"]) > limit;
            })
        }

        // Filter out metadata options to only those requested
        if ("metadata" in request.query) {
            let metadata = request.query.get("metadata").split(',');
            // For each node, filter their metadata attributes
            for (let n of nodes) {
                let new_map = {};
                for (let [k, v] of Object.entries(n.metadata)) {
                    if (k in metadata) {
                        new_map[k] = v;
                    }
                }
                n.metadata = NodeMetadata.interpretObject(new_map);
            }
        }

        // TODO Pagination
        response.send(nodes);
    }
    
    private addTemplatedNode(node_request: NodeTemplate) {
        let new_id = this.idGenerator.next();
        node_request['metadata']['id'] = new_id;
        this.nodes.push(Node.interpretObject(node_request));

        console.log("Adding new node.")
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
        console.log("Adding new node.")
        if (!(request.body instanceof Array)) {
            response.status(httpStatus.BAD_REQUEST).send("POST data did not contain Array as top-level");
            return;
        }
        for (const n of request.body) {
            try {
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
        response.status(httpStatus.OK).send();
    }
}

export default NodesController;