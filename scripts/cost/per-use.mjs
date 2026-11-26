// What one use of the service takes, as counted on the local run by
// src/cost/per-use.test.ts (D-141) and written down here so the cost formula
// has a starting value. Replace them with the production measurement
// (docs/dev/scale-cost.md); `--per-use FILE` does that without editing this
// file. src/cost/per-use.test.ts fails when the code drifts from these values.
//
// Worker requests, R2 operations and D1 queries come from the code. D1 rows
// read are for the data of src/cost/test-dataset.ts (10,000 slides, 1,000
// people). `cpuMs` is this machine's CPU time for the Node side of the same
// steps: an upper bound to start from, not the CPU time Cloudflare bills.

/** Sizes of a slide: the number of files in its version. */
export const FILES = { small: 5, normal: 30, large: 100 }

export const PER_USE = {
  small: {
    view: {
      workerRequests: 8,
      internalRequests: 5,
      d1Queries: 20,
      cpuMs: 306,
      d1RowsRead: 40036,
      d1RowsWritten: 0,
      r2ClassA: 0,
      r2ClassB: 5,
    },
    revisit: {
      workerRequests: 8,
      internalRequests: 0,
      d1Queries: 20,
      cpuMs: 152,
      d1RowsRead: 40036,
      d1RowsWritten: 0,
      r2ClassA: 0,
      r2ClassB: 0,
    },
    upload: {
      workerRequests: 7,
      internalRequests: 0,
      d1Queries: 71,
      cpuMs: 706,
      d1RowsRead: 130,
      d1RowsWritten: 43,
      r2ClassA: 5,
      r2ClassB: 7,
    },
  },
  normal: {
    view: {
      workerRequests: 33,
      internalRequests: 30,
      d1Queries: 70,
      cpuMs: 641,
      d1RowsRead: 40111,
      d1RowsWritten: 0,
      r2ClassA: 0,
      r2ClassB: 30,
    },
    revisit: {
      workerRequests: 33,
      internalRequests: 0,
      d1Queries: 70,
      cpuMs: 551,
      d1RowsRead: 40111,
      d1RowsWritten: 0,
      r2ClassA: 0,
      r2ClassB: 0,
    },
    upload: {
      workerRequests: 32,
      internalRequests: 0,
      d1Queries: 296,
      cpuMs: 2949,
      d1RowsRead: 549,
      d1RowsWritten: 193,
      r2ClassA: 30,
      r2ClassB: 32,
    },
  },
  large: {
    view: {
      workerRequests: 103,
      internalRequests: 100,
      d1Queries: 210,
      cpuMs: 2248,
      d1RowsRead: 40321,
      d1RowsWritten: 0,
      r2ClassA: 0,
      r2ClassB: 100,
    },
    revisit: {
      workerRequests: 103,
      internalRequests: 0,
      d1Queries: 210,
      cpuMs: 1957,
      d1RowsRead: 40321,
      d1RowsWritten: 0,
      r2ClassA: 0,
      r2ClassB: 0,
    },
    upload: {
      workerRequests: 102,
      internalRequests: 0,
      d1Queries: 926,
      cpuMs: 7316,
      d1RowsRead: 1635,
      d1RowsWritten: 613,
      r2ClassA: 100,
      r2ClassB: 102,
    },
  },
  list: {
    topVisitor: {
      workerRequests: 3,
      internalRequests: 0,
      d1Queries: 2,
      cpuMs: 33,
      d1RowsRead: 15160,
      d1RowsWritten: 0,
      r2ClassA: 0,
      r2ClassB: 0,
    },
    topMember: {
      workerRequests: 5,
      internalRequests: 0,
      d1Queries: 34,
      cpuMs: 389,
      d1RowsRead: 32277,
      d1RowsWritten: 0,
      r2ClassA: 0,
      r2ClassB: 0,
    },
    profile: {
      workerRequests: 1,
      internalRequests: 0,
      d1Queries: 11,
      cpuMs: 138,
      d1RowsRead: 30473,
      d1RowsWritten: 0,
      r2ClassA: 0,
      r2ClassB: 0,
    },
    community: {
      workerRequests: 1,
      internalRequests: 0,
      d1Queries: 5,
      cpuMs: 42,
      d1RowsRead: 207,
      d1RowsWritten: 0,
      r2ClassA: 0,
      r2ClassB: 0,
    },
  },
  cover: {
    workerRequests: 1,
    internalRequests: 1,
    d1Queries: 1,
    cpuMs: 9,
    d1RowsRead: 2,
    d1RowsWritten: 0,
    r2ClassA: 0,
    r2ClassB: 0,
  },
}
