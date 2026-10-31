// Print a scrypt hash for a NEXUS_USERS entry. Reads the password from stdin
// so it does not land in shell history: `npm run user:hash` then type it.
import { createInterface } from "node:readline";
import { hashPassword } from "../lib/passwords";

const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: process.stdin.isTTY });
rl.question("Password (min 12 chars): ", (password) => {
  rl.close();
  try {
    console.log(hashPassword(password.trim()));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
});
