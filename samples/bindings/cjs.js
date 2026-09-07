// CommonJS: `exports.f = ...` is the module's own namespace, so it declares an
// export; `module.exports.helper = helper` is an alias that exports `helper`.
function helper() {
  return 1;
}

exports.run = function () {
  return helper();
};

module.exports.helper = helper;
