const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
const removeFlavor = html.match(/    function removeFlavor\(boxIdx, flavorIdx\) \{[\s\S]*?\n    \}/);
assert.ok(removeFlavor, 'No se encontró la función removeFlavor');

function createBuilder(boxes, sizes, names) {
  const elements = {};
  const context = vm.createContext({
    activeBoxes: boxes,
    boxSizes: sizes,
    boxNames: names,
    currentSize: sizes[sizes.length - 1],
    document: {
      getElementById(id) {
        if (!elements[id]) {
          elements[id] = {
            hidden: false,
            classList: { add() { elements[id].hidden = true; } },
            setAttribute(name, value) { elements[id][name] = value; }
          };
        }
        return elements[id];
      }
    },
    renderBuilder() { context.renderCount++; },
    renderCount: 0
  });
  vm.runInContext(removeFlavor[0], context);
  return { context, elements };
}

test('eliminar la última galleta quita una caja adicional y conserva la anterior', () => {
  const { context, elements } = createBuilder([[1, 2, 3, 4], [5]], [4, 1], ['Regalo', '']);
  context.removeFlavor(1, 0);
  assert.deepEqual(context.activeBoxes, [[1, 2, 3, 4]]);
  assert.deepEqual(context.boxSizes, [4]);
  assert.deepEqual(context.boxNames, ['Regalo']);
  assert.equal(context.currentSize, 4);
  assert.equal(context.renderCount, 1);
  assert.equal(elements['new-box-options'].hidden, true);
  assert.equal(elements['add-box-button']['aria-expanded'], 'false');
});

test('al vaciar una caja anterior se conserva el tamaño y nombre de las posteriores', () => {
  const { context } = createBuilder([[1], [2, 3], [4]], [1, 4, 1], ['', 'Sorpresa', '']);
  context.removeFlavor(0, 0);
  assert.deepEqual(context.activeBoxes, [[2, 3], [4]]);
  assert.deepEqual(context.boxSizes, [4, 1]);
  assert.deepEqual(context.boxNames, ['Sorpresa', '']);
  assert.equal(context.currentSize, 1);
});

test('una caja parcialmente llena permanece y la última caja vacía permite recomenzar', () => {
  const { context } = createBuilder([[1, 2]], [4], ['Regalo']);
  context.removeFlavor(0, 0);
  assert.deepEqual(context.activeBoxes, [[2]]);
  context.removeFlavor(0, 0);
  assert.deepEqual(context.activeBoxes, [[]]);
  assert.deepEqual(context.boxSizes, [4]);
  assert.equal(context.currentSize, 4);
});
