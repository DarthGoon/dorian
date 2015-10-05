var fs = require('fs');
var async = require('async');
var cmbx = require('./lib/combinatorics').Combinatorics;
var mocha_module = require('mocha');
var assert = require('chai').assert;
var istanbul = require('istanbul');
var istanbul_core = require('./lib/istanbul-core');
istanbul_core.hookLoader('/Users/adayalan/Engineering/opal', {
    postLoadHook: function (matcherFn, transformer, verbose) {
        return function(file) {
            if (matcherFn(file)) {
                console.log("Instrumenting: %s", file);
            }
        };
    }
});

/**
 *  All of this is in the auto-cover branch, because i still haven't been able
 *  to get a good coverage report generated.  This memory leak is just the latest
 *  hurdle.  I'm gaining on this one though :)

    So theres a memory leak.  Lets try to optimize execution and allocation.
    No unnecessary frames.  Lightweight objects.  Serial test execution and generation.
    Separate static and dynamic objects and funcs.
 */

/**
 * Static memory allocations
 * Try to get as much of the constant stuff in here so it consolidates memory.
 * Avoid any objects the grow, keep recursion in mind, move them to the workspace (below)
 */
var dorian_ops = {
    mocha_instance: new mocha_module({ui: 'tdd', reporter: 'spec'}),
    function_blacklist: ['send_email_to_team', 'fraudCheck'],
    callback_whitelist: ['callback', 'next', 'cb'],
    arg_test_values: [{}, [], 0, 1],
    fn_slicer: /(?:function\s\w+\(|function\s\()([^\)]+)\)/,
    fn_name_slicer: /(?:function\s)(\w+)/,
    coverage_collector: istanbul.Collector(),
    coverage_reporter: istanbul.Report,
    walkTheTree: function walkTheTree(exported_object, parent_key) {
        parent_key = parent_key || '';
        switch (typeof exported_object) {
            case 'function':
                this.testFn(exported_object);
                break;
            case 'object':
                async.forEachOf(exported_object, function (val, key, callback) {
                    val && console.log('Inspecting object: %s.%s', parent_key, key)
                    this.walkTheTree(val, parent_key + '.' + key);
                }, function (err) {
                    err && console.error('ERROR: inspecting object tree', err)
                        || console.log('Inspected object tree: %s', parent_key);
                });
                break;
            case 'string':
            case 'number':
            case 'boolean':
            default:
                console.log('Skipping primitive prop: %s', parent_key);
                break;
        }
    },
    testFn: function testFn(exported_object) {
        var fn_declaration, fn_args, fn_name, test_matrix;
        fn_declaration = this.fn_slicer.exec(exported_object.toString());
        if (fn_declaration) {
            fn_args = fn_declaration[1].replace(/\s/g, '').split(',');
            fn_name = this.fn_name_slicer.exec(fn_declaration[0]);
            if (fn_name && this.function_blacklist.indexOf(fn_name[1]) != -1) {
                return;
            }
            test_matrix = this.generateMatrix(fn_args);

            if (test_matrix.values.length > 0) {
                async.each(test_matrix.values, function(fn_args){
                    mocha.suite.addTest(new mocha_module.Test(fn_declaration[0] + ' - handles - ' + JSON.stringify(fn_args), function (done) {
                        var test_wired_args,
                            assertion;
                        if (test_matrix.hasCallback) {
                            test_wired_args = fill_callback_fn({
                                matrix: fn_args,
                                callback_arg_position: test_matrix.callback_arg_position
                            }, done)
                        }

                        assertion = assert.doesNotThrow(exported_object.bind(this, test_wired_args), /.*/);

                        if (assertion && !test_matrix.hasCallback) {
                            walkTheTree(exported_object.bind(this, test_wired_args));
                            done();
                        }
                    }));
                });
            } else {
                mocha.suite.addTest(new mochaTest(fn_declaration[0] + ' - handles - ' + JSON.stringify(fn_args), function (done) {
                    var test_wired_args = [],
                        assertion;
                    if (hasCallback) {
                        test_wired_args = [callback_fn(done)];
                    }

                    assertion = assert.doesNotThrow(exported_object.bind(this, test_wired_args), /.*/);

                    if (assertion && !hasCallback) {
                        walkTheTree(exported_object.bind(this, test_wired_args));
                        done();
                    }
                }));
            }
        }
    },
    callback_fn: function callback_fn(done) {
        return function () {
            if (arguments) {
                for (var idx = 0; idx < arguments.length; idx++) {
                    expect(typeof arguments[idx]).to.not.eq('error')
                        && arguments[idx]
                        && this.walkTheTree(arguments[idx]);
                }
            }
            done();
        };
    },
    fill_callback_fn: function fill_callback_fn(options, done) {
        options.matrix.splice(options.callback_arg_position, 0, this.callback_fn(done));
        return matrix;
    },
    generateMatrix: function generateMatrix(fn_args){
        /**
         This is used to detect a callback as one of the fn_params
         But this happens by arg name in a whitelist.  Which is kinda dumb.
         Do it better.
         */
        var callback_arg_position = -1,
            matrix = {};
        this.callback_whitelist.forEach(function(list_item){
            if (callback_arg_position == -1) {
                callback_arg_position = fn_args.indexOf(list_item);
            }
        });
        if(callback_arg_position == -1){
            matrix.values = fn_args.length > 0 && cmbx.baseN(this.arg_test_values, fn_args.length).toArray();
        } else {
            matrix = {
                values: cmbx.baseN(this.arg_test_values, fn_args.length - 1).toArray(),
                hasCallback: true,
                callback_arg_position: callback_arg_position,
                wireCallback: this.fill_callback_fn
            };
        }
        return matrix;
    },
    buildTestSuite: function buildTestSuite() {
        var floor = multi_pass_generator.length;
        if (test_pass_incrementor == 0 || multi_pass_generator.length < 100){
            floor = 0;
        } else {
            floor = multi_pass_generator.length - 100;
        }
        console.log('Building new test suite');
        while (multi_pass_generator.length > floor) {
            multi_pass_generator.pop()();
        }
    },
    seeWhatBreaks: function seeWhatBreaks() {
        module.parent.children.forEach(function (module) {
            if (module.filename.indexOf('node_modules') == -1
                || module.filename.indexOf('dorian') == -1) {  //TODO: stupid hack while the module doesn't come from npm
                internal_modules.push(module);
            }
        });

        internal_modules.forEach(function (app_module) {
            var exported_object = app_module.exports;
            walkTheTree(exported_object);
        });



        buildTestSuite();

        incrementalMochaRun(dorian_ctx.coverage_collector, function (failures) {
            var report = dorian_ctx.coverage_reporter.create('html');
            report.writeReport(dorian_ctx.coverage_collector, true, function () {
                console.log('Generated report');
            });

            console.log('Tests ran: %s', dorian_ctx.mocha.suite.tests.length);
            console.log('Failures: %s', failures || 0);
            console.log('Dorian run successful');
        });
    },
    incrementalMochaRun: function incrementalMochaRun(collector, callback) {
        setTimeout(function () {
            var mocha_instance = mocha,
                coverage = global.__coverage__ = global.__coverage__ || {};
            mocha = new mocha_module({
                ui: 'tdd',
                reporter: 'spec'
            });

            test_pass_incrementor++;
            console.log('Tests generated for pass (%s): %s', test_pass_incrementor, mocha_instance.suite.tests.length);
            console.log('Starting Mocha test run...');

            mocha_instance.run(function (failures) {
                collector.add(coverage);
                buildTestSuite();
                if (mocha.suite.tests.length > 0) {
                    incrementalMochaRun(collector, callback);
                } else {
                    callback(failures);
                }
            });
        }, 1000);
    }
};

/**
 * Dynamic memory allocation
 * Keep all expando objects in here.  Treat this as the dorian ops RAM disk.
 *
 * Optimization for later- attempt to predict an object's upper-bound
 * memory usage, and pre-allocate at an appropriate size.
 */
var dorian_workspace = {
    internal_modules: [],
    multi_pass_generator: [],
    test_pass_incrementor: 0,

};


module.exports = {
    run: seeWhatBreaks
};
