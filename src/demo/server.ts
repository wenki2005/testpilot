/** Keep the launch path while configuring user data before adapter initialization. */
import { configureDataEnvironment } from '../bootstrap/data-environment.js';
configureDataEnvironment();
await import('../server/http-server.js');
