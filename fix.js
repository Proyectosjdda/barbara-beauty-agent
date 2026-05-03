const fs = require('fs');
let code = fs.readFileSync('bot.js', 'utf8');

const regex = /(['"\`])(Princesa|Linda|Reina|Nena|Bella|Hermosa)(,?)\s+/gi;
code = code.replace(regex, '$1');

fs.writeFileSync('bot.js', code);
console.log('Fixed');
