import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

import { ERROR_CODES } from '../../src/types/events';

/**
 * The reference guides are the contract as a consumer reads it, and nothing at runtime compares
 * them to the types: a prop renamed in `src/types/` leaves a page describing something that no
 * longer exists, and a prop added without a page is a feature nobody can find.
 *
 * The type side is read through the TypeScript compiler rather than by regex, so a member that
 * arrives through an intersection or a mapped type still counts.
 */
const CORE = resolve(__dirname, '../../..', 'packages/core');
const REFERENCE = resolve(CORE, '../../guides/reference');

function membersOf(typeName: string): string[] {
  const entry = resolve(CORE, 'src/types/props.ts');
  const program = ts.createProgram([entry], {
    target: ts.ScriptTarget.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(entry);
  assert.ok(source !== undefined, `${entry} is not in the program`);

  let found: ts.Type | null = null;
  ts.forEachChild(source, (node) => {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === typeName) {
      found = checker.getTypeAtLocation(node.name);
    }
  });

  assert.ok(found !== null, `${typeName} is not declared in ${entry}`);
  return checker.getPropertiesOfType(found).map((symbol) => symbol.getName());
}

/** Every reference page as one string: which page documents a member is not this test's business. */
function reference(): string {
  return readdirSync(REFERENCE)
    .filter((name) => name.endsWith('.md'))
    .map((name) => readFileSync(resolve(REFERENCE, name), 'utf8'))
    .join('\n');
}

function documents(docs: string, name: string): boolean {
  // Backticked on its own, or declared in a code fence with an optional marker or a call.
  return (
    docs.includes(`\`${name}\``) ||
    new RegExp(`^\\s*${name}\\??[:(]`, 'm').test(docs) ||
    docs.includes(`\`${name}(`)
  );
}

test('every <PoseCamera> prop is documented in the reference', () => {
  const docs = reference();
  const undocumented = membersOf('PoseCameraProps').filter((name) => !documents(docs, name));

  assert.deepEqual(
    undocumented,
    [],
    'these props exist on PoseCameraProps but appear nowhere in guides/reference/',
  );
});

test('every ref method is documented in the reference', () => {
  const docs = reference();
  const undocumented = membersOf('PoseCameraRef').filter((name) => !documents(docs, name));

  assert.deepEqual(undocumented, [], 'these methods exist on PoseCameraRef but are not documented');
});

test('the events table lists exactly the callbacks the props declare', () => {
  const source = readFileSync(resolve(REFERENCE, 'events.md'), 'utf8');
  const table = /\| Callback \| Fires \| Rate \|\n\|[^\n]*\|\n([\s\S]*?)\n\n/.exec(source)?.[1];
  assert.ok(table !== undefined, 'could not find the callback table in events.md');

  const documented = [...table.matchAll(/^\| `(on\w+)` \|/gm)].map((match) => match[1]).sort();
  const declared = membersOf('PoseCameraProps')
    .filter((name) => name.startsWith('on'))
    .sort();

  assert.deepEqual(documented, declared);
});

test('every error code has a row in the events reference', () => {
  const source = readFileSync(resolve(REFERENCE, 'events.md'), 'utf8');
  const documented = [...source.matchAll(/^\| `([A-Z_]+)` \|/gm)].map((match) => match[1]);
  const missing = ERROR_CODES.filter((code) => !documented.includes(code));

  assert.deepEqual(missing, [], 'these ErrorCodes are in the union but have no documented row');

  // And nothing documented that the union dropped, which is the direction that leaves a consumer
  // switching on a code native can never send.
  const stale = documented.filter((code) => !ERROR_CODES.includes(code as never));
  assert.deepEqual(stale, []);
});
