'use strict';

var fs = require('node:fs');
var path = require('node:path');
var root = __dirname;
var source = path.join(root, 'src', 'circleftp.js');
var target = path.join(root, 'providers', 'circleftp.js');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.copyFileSync(source, target);
console.log('Built ' + path.relative(root, target));
