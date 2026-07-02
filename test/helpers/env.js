"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withEnv = withEnv;
// Scoped env override on top of the scrubbed baseline (qa.md §6).
// Sets the given vars, runs `fn`, then restores the prior values — so a test
// that needs a specific env doesn't leak it into the next one.
function withEnv(vars, fn) {
    const prev = {};
    for (const [k, v] of Object.entries(vars)) {
        prev[k] = process.env[k];
        if (v === undefined)
            delete process.env[k];
        else
            process.env[k] = v;
    }
    try {
        fn();
    }
    finally {
        for (const [k, v] of Object.entries(prev)) {
            if (v === undefined)
                delete process.env[k];
            else
                process.env[k] = v;
        }
    }
}
//# sourceMappingURL=env.js.map