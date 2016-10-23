exports.btoa = function btoa(str) {
	return new Buffer(str.toString(), 'binary').toString('base64');
};

exports.atob = function atob(str) {
	return new Buffer(str.toString(), 'base64').toString('binary');
};
