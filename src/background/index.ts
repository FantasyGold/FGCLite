import FGCLiteController from './controllers';

// Add instance to window for debugging
const controller = new FGCLiteController();
Object.assign(window, { controller });
