import * as express from 'express';
import Node from './node.interface';

interface NodeRequestMetadata {
    type: string;
    parent: string;
}

interface NodeRequest {
    metadata: NodeRequestMetadata;
    data: Map<string, string>;
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

    private handleGetNodes(request: express.Request, response: express.Response) {
        const supported_args = new Set(["type", "state", "metadata", "new"]);

        // Check for unexpected parameters and log them.
        for (const k of Object.keys(request.query)) {
            if (!(k in supported_args)) {
                console.log("Router '%s' - Recieved packet with unsupported parameter '%s'", this.path, k);
                // TODO - Return invalid request.
                return;
            }
        }
        // Create a response object with just the node's metadata
        let nodes : Node[] = [];
        for (const n of this.nodes) {
            nodes.push({
                "metadata": new Object(n.metadata),
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
            let limit : number = Number(request.query["new"]);
            if (isNaN(limit)) {
                console.log("Router '%s' - Recieved packet with new parameter '%s' this is NaN.", this.path, limit);
                // TODO - Return invalid request.
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
                n.metadata = new_map;
            }
        }

        response.send(nodes);
    }
    
    // TODO Type for node request
    private addNewNode(node_request: any) {
    }

    private handlePutNodes(request: express.Request, response: express.Response) {
        // TODO Actually convert these into new bodies
        //
        const node_requests: Node[] = request.body;
        for (const n of node_requests) {
            //
        }
    }
}

export default NodesController;