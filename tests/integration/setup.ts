import { config } from "dotenv";
import * as path from "path";

config({ path: path.resolve(__dirname, "../../.env.local") });
