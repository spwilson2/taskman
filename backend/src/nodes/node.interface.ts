interface NodeMetadata extends Map<String, String> {
    // TODO, This probably needs to be a concrete class
    //id: String;
};

interface Node {
    //metadata: NodeMetadata;
    metadata: object;
    data?: object;
}

export default Node;