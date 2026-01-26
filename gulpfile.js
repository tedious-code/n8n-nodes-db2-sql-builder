const path = require('path');
const { task, src, dest } = require('gulp');

task('build:icons', function () {
	return src(['nodes/**/*.{png,svg,SVG}', 'credentials/**/*.{png,svg,SVG}'], {
		base: '.',
	}).pipe(dest('dist'));
});
