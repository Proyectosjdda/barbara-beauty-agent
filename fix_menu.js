const fs = require('fs');
let c = fs.readFileSync('bot.js', 'utf8');

// Remove unused isRetoque variable in ADDING_MORE_SERVICES
c = c.replace(
    "const isRetoque = sessions[from].flowType === 'RETOQUE';\r\n                const sofar",
    "const sofar"
);

// Add option 6 to the menu shown when user returns to pick another service
// The menu text ends with 'Efectos Especiales 🎀`);' followed by '} else if (isNo'
const oldMenu = "Efectos Especiales \uD83C\uDF80\`);";
const newMenu = "Efectos Especiales \uD83C\uDF80\\n6. No deseo otro servicio, continuar \u2705\`);";

// Only replace the FIRST occurrence (which is in ADDING_MORE_SERVICES block)
const idx = c.indexOf(oldMenu);
if (idx < 0) {
    console.log('Menu text NOT FOUND');
    process.exit(1);
}
c = c.slice(0, idx) + newMenu + c.slice(idx + oldMenu.length);

fs.writeFileSync('bot.js', c, 'utf8');
console.log('Done! Menu updated.');
