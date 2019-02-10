const { getVersion } = require('./header');

module.exports = function getAlphabets(state) {
	return [
		'abcdefghijklmnopqrstuvwxyz',
		'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
		getVersion(state) === 1 ?
			' 0123456789.,!?_#\'"/\\<-:()' :
			' \n0123456789.,!?_#\'"/\\-:()'
	];
}
