const fs = require('fs');
const path = require('path');
const [, , infile, outdir, name, title] = process.argv;

// set this low enough that you can upload
const SIZE = 14000;

const memory = Array.from(fs.readFileSync(infile));
if (memory[0] <= 3) {
	memory[0x01] |= (
		(1 << 4)   // Status line not available?
	);
	memory[0x01] &= ~(
		(1 << 5) | // Screen-splitting available?
		(1 << 6)   // Is a variable-pitch font the default?
	);
} else {
	memory[0x01] &= ~(
		(1 << 0) | // Colours available?
		(1 << 1) | // Picture displaying available?
		(1 << 2) | // Boldface available?
		(1 << 3) | // Italic available?
		(1 << 4) | // Fixed-space font available?
		(1 << 5) | // Sound effects available?
		(1 << 7)   // Timed keyboard input available?
	);
	memory[0x10] &= ~(
		// (For bits 3,4,5,7 and 8, Int clears again if it cannot provide the requested effect.)
		(1 << 3) | // 3: If set, game wants to use pictures
		(1 << 4) | // 4: If set, game wants to use the UNDO opcodes
		(1 << 5) | // 5: If set, game wants to use a mouse
		(1 << 7) | // 7: If set, game wants to use sound effects
		(1 << 8) // 8: If set, game wants to use menus
	);
}

function sliceBy(array, size) {
	const result = [];
	for (let i = 0; i < array.length; i += size) {
		result.push(array.slice(i, i + size));
	}
	return result;
}

const textAll = (b64, update) => `function () {
    var b64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    var b64tab = function(bin) {
        var t = {};
        for (var i = 0, l = bin.length; i < l; i++) t[bin.charAt(i)] = i;
        return t;
    }(b64chars);
	var cb_decode = cccc => {
        var len = cccc.length,
        padlen = len % 4,
        n =   (len > 0 ? b64tab[cccc.charAt(0)] << 18 : 0)
            | (len > 1 ? b64tab[cccc.charAt(1)] << 12 : 0)
            | (len > 2 ? b64tab[cccc.charAt(2)] <<  6 : 0)
            | (len > 3 ? b64tab[cccc.charAt(3)]       : 0),
        chars = [
            String.fromCharCode( n >>> 16),
            String.fromCharCode((n >>>  8) & 0xff),
            String.fromCharCode( n         & 0xff)
        ];
        chars.length -= [0, 0, 2, 1][padlen];
        return chars.join('');
    };
	let memory =
		${
			sliceBy(b64, 80)
				.map(slice => "'" + slice.replace(/\//g, '\\/') + "'")
				.join('+\n        ')
		};
	memory = memory.replace(/\\S{1,4}/g, cb_decode);
	memory = memory.split('').map(c => c.charCodeAt(0));
	${update}
	let story = #db.f({ type: 'zmachine/story', name: '${name}' }).first();
	return story.memory.length;
}
`;

const textFirst = b64 => textAll(b64, `#db.r({ type: 'zmachine/story', name: '${name}' });
	#db.i({ type: 'zmachine/story', name: '${name}', title: '${title}', memory });`);
const textNext = b64 => textAll(b64, `#db.u({ type: 'zmachine/story', name: '${name}' }, { $push: { memory: { $each: memory }}});`);

sliceBy(memory, SIZE).forEach((slice, i) => {
	const b64 = Buffer.from(slice).toString('base64').replace(/[^A-Za-z0-9\+\/]/g, '');
	const text = (i === 0) ? textFirst(b64) : textNext(b64);
	const outfile = path.join(outdir, name + '_' + i.toString(10).padStart(2, '0') + '.js');
	fs.writeFileSync(
		outfile,
		text);
	console.log(outfile);
});
