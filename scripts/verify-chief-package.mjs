import { resolve } from "node:path";
import { verifyChiefPackage } from "./chief-package-policy.mjs";
if (!process.argv[2]) throw new Error("Pass the packaged resources directory");
console.log(JSON.stringify(verifyChiefPackage(resolve(process.argv[2])), null, 2));
