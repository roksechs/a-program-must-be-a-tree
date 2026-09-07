// Definition-time bindings on an undeclared global (the d3 v3 style).
// `chart` is declared nowhere in this program; each assignment below binds a
// name other code can use, so each is a declaration with a qualified name:
// `chart.scale` (a namespace variable) and `chart.scale.linear` (a function).
chart.scale = {};

chart.scale.linear = function () {
  return interpolate(0, 1);
};

function interpolate(a, b) {
  return a + b;
}
