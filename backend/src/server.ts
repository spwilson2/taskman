import App from './app';
import NodesController from './nodes/nodes.controller';

const app = new App(
      [
            new NodesController(),
      ],
      5000,
);

app.listen();