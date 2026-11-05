const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const content = require('../engine/content.cjs');
const { getArgs } = require('../ouncecake.cjs');

const title = '0100f43008c44000';
const patchTitle = '0100f43008c44800';

function record(contentTitle, version, storage, programs = [0]) {
  const metaKey = Buffer.alloc(16);
  metaKey.writeBigUInt64LE(BigInt('0x' + contentTitle));
  metaKey.writeUInt32LE(version, 8);
  metaKey[12] = contentTitle === title ? 0x80 : 0x81;
  return {
    contentTitle, version, storage, metaKey,
    contents: programs.map(programIndex => ({
      contentType: 1, programIndex, attributes: 0,
      contentId: Buffer.from(metaKey).fill(programIndex + storage, 12).toString('hex'),
    })),
  };
}

const newest = record(patchTitle, 393216, 4, [0, 1]);
const cartridge = record(patchTitle, 65536, 2, [0, 1]);

test('selects the newest update across storage, regardless of discovery order', () => {
  assert.deepEqual(content.selectUpdates([cartridge, newest]), [newest]);
  assert.deepEqual(content.selectUpdates([newest, cartridge]), [newest]);
});

test('preserves same-version storage alternatives and every program', () => {
  const sd = record(patchTitle, newest.version, 5, [0, 1]);
  const selected = content.selectUpdates([cartridge, sd, newest]);
  assert.deepEqual(selected, [sd, newest]);
  assert.deepEqual(selected[0].contents.map(item => item.programIndex), [0, 1]);
});

test('selects versions per content title without changing base-only games', () => {
  const other = record('0100000000000800', 1, 5);
  assert.deepEqual(content.selectUpdates([newest, cartridge, other]), [newest, other]);
  assert.deepEqual(content.selectUpdates([]), []);
  assert.deepEqual(content.selectUpdates([cartridge]), [cartridge]);
});

test('can select an older version and rejects unavailable versions', () => {
  assert.deepEqual(content.selectUpdates([newest, cartridge], 65536), [cartridge]);
  assert.throws(() => content.selectUpdates([newest], 65536), /was not found/);
  assert.throws(() => content.selectUpdates([], 0), /was not found/);
});

test('parses update versions alongside existing options', () => {
  assert.equal(getArgs(['run']).updateVersion, undefined);
  const options = getArgs(['run', title, '--tar', '--update-version', '65536', '--port', '2222']);
  assert.equal(options.updateVersion, 65536);
  assert.equal(options.title, title);
  assert.equal(options.tar, true);
  assert.equal(options.port, 2222);
  for (const value of ['0', '4294967295']) {
    assert.equal(getArgs(['run', '--update-version', value]).updateVersion, Number(value));
  }
  for (const value of ['', '-1', '1.5', '1e3', '0x10000', '4294967296', '--tar']) {
    assert.throws(() => getArgs(['run', '--update-version', value]), /Invalid --update-version/);
  }
  assert.throws(() => getArgs(['run', '--update-version']), /Invalid --update-version/);
});

function preparation(installedUpdates) {
  const base = record(title, 0, 2);
  const records = [base, ...installedUpdates];
  const openedUpdates = [];
  const handles = new Set([1]);
  const databases = new Map();
  const logs = [];
  let nextHandle = 10;
  let mounts = 0;
  const open = () => {
    const handle = nextHandle++;
    handles.add(handle);
    return handle;
  };
  const reply = data => ({ result: 0, data });
  const emptyRomfs = Buffer.alloc(0x68);
  [0x50, 0x50, 0, 0x50, 24, 0x68, 0, 0x68, 0, 0x68].forEach((n, i) =>
    emptyRomfs.writeBigUInt64LE(BigInt(n), i * 8));
  emptyRomfs.fill(0xff, 0x54, 0x64);
  const attachment = {
    root: 1,
    service: async () => 2,
    s: {
      base: 0x100000, handles,
      write: async () => {},
      close: async handle => handles.delete(handle),
      async ipc(label, handle, command, input) {
        if (label === 'Game storage size') {
          const data = Buffer.alloc(8);
          data.writeBigUInt64LE(BigInt(emptyRomfs.length));
          return reply(data);
        }
        if (label === 'Read game directory') return reply(Buffer.alloc(8));
        if (label === 'FTP pin source database') {
          const handle = open();
          databases.set(handle, input[0]);
          return { result: 0, handle };
        }
        const storage = databases.get(handle);
        if (label === 'FTP pin source version') {
          const found = records.find(item => item.storage === storage &&
            item.metaKey.subarray(0, 8).equals(input));
          return reply(found.metaKey);
        }
        if (label === 'FTP pin source content') {
          const found = records.find(item => item.storage === storage &&
            item.metaKey.equals(input.subarray(8)));
          const entry = found.contents.find(item => item.contentType === input[0] &&
            item.programIndex === input[1]);
          return reply(Buffer.from(entry.contentId, 'hex'));
        }
        throw new Error('Unexpected IPC: ' + label);
      },
    },
    domain: {
      oneHandle: reply => reply.handle,
      send: async () => { mounts++; return { result: 0, handle: open() }; },
    },
    filesystem: {
      pathMethod: async () => ({ result: 0, handle: open() }),
      readStorage: async (s, handle, offset, length) => emptyRomfs.subarray(offset, offset + length),
    },
  };
  const dependencies = {
    './content.cjs': {
      ...content,
      discoverBase: async () => [base],
      discoverUpdates: async () => installedUpdates,
      discoverDlc: async () => [],
      discoverDataPatches: async () => [],
      async resolveContent(options) {
        const record = options.base || options.update;
        return {
          ...record, ...options.content,
          selection: options.update ? 'update' : undefined,
          contentPath: '@test/' + options.content.contentId,
          runtimeProgramId: title,
        };
      },
    },
    './program.cjs': {
      createProgramMounts: () => ({
        openCode: async () => { mounts++; return open(); },
        openUpdate: async ({ source }) => { openedUpdates.push(source); return open(); },
      }),
    },
  };
  const module = { exports: {} };
  const filename = path.join(__dirname, '../engine/mounts.cjs');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, Buffer,
    console: { log: (...args) => logs.push(args.join(' ')) },
    require: id => dependencies[id] || require(id.startsWith('.') ? path.resolve(path.dirname(filename), id) : id),
  }, { filename });
  return { prepareGame: module.exports.prepareGame, attachment, openedUpdates, logs, mountCount: () => mounts };
}

for (const tar of [false, true]) {
  test('prepares both latest programs without opening the older update, tar=' + tar, async () => {
    const fixture = preparation([newest, cartridge]);
    const result = await fixture.prepareGame({ attachment: fixture.attachment, title, tar });
    assert.deepEqual(fixture.openedUpdates.map(source => [source.version, source.programIndex]),
      [[393216, 0], [393216, 0], [393216, 1], [393216, 1]]);
    assert.equal(result.index.readUInt32LE(8), tar ? 2 : 1);
    assert.ok(result.index.includes(Buffer.from('393216')));
    assert.ok(!result.index.includes(Buffer.from('65536')));
    assert.ok(result.sources.some(item => !item.source.selection));
    assert.ok(fixture.logs.some(line => line.includes('Skipping other update versions: 65536')));
  });

  test('prepares an explicitly selected older update by itself, tar=' + tar, async () => {
    const fixture = preparation([newest, cartridge]);
    await fixture.prepareGame({ attachment: fixture.attachment, title, tar, updateVersion: 65536 });
    assert.deepEqual(fixture.openedUpdates.map(source => [source.version, source.programIndex]),
      [[65536, 0], [65536, 0], [65536, 1], [65536, 1]]);
  });
}

test('rejects a missing requested version before mounting game content', async () => {
  const fixture = preparation([newest]);
  await assert.rejects(fixture.prepareGame({ attachment: fixture.attachment, title, updateVersion: 65536 }),
    /was not found/);
  assert.equal(fixture.mountCount(), 0);
  assert.equal(fixture.openedUpdates.length, 0);
});

test('still prepares a game with no updates', async () => {
  const fixture = preparation([]);
  const result = await fixture.prepareGame({ attachment: fixture.attachment, title });
  assert.equal(fixture.openedUpdates.length, 0);
  assert.ok(result.sources.length > 0);
});
