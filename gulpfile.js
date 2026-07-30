const { task, src, dest } = require('gulp');

task('build:icons', function () {
	return src(
		[
			'nodes/**/*.{png,svg,SVG,json}',
			'credentials/**/*.{png,svg,SVG,json}',
		],
		{ base: '.' },
	).pipe(dest('dist'));
});
