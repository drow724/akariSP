// Type-checked against the packed tarball by test/package.test.ts; every import must fail.
// @ts-expect-error not exported
import * as m1 from 'akarisp/core';
// @ts-expect-error not exported
import * as m2 from 'akarisp/browser';
// @ts-expect-error not exported
import * as m3 from 'akarisp/internal';
// @ts-expect-error not exported
import * as m4 from 'akarisp/dist/index.js';
// @ts-expect-error not exported
import * as m5 from 'akarisp/dist/core/runtime.js';
// @ts-expect-error not exported
import * as m6 from 'akarisp/src/index.ts';
// @ts-expect-error not exported
import * as m7 from 'akarisp/package.json';
