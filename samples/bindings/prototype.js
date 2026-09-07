// A class written the ES5 way (the moment.js style). Every binding below runs
// once, when the module loads, through a path of names, so each declares.
export function Moment(config) {
  this.config = config;
}

var proto = Moment.prototype;

export function add(n) {
  return this.config + n;
}

// An alias: `add` keeps its node and gains the member role (Moment.add).
proto.add = add;

// An instance member, spelled outside the class body.
proto.isValid = function () {
  return this.add(0) > 0;
};

// A static member.
Moment.utc = function () {
  return new Moment(1);
};
