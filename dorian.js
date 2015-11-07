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
var dorian_OPS = {};
Object.defineProperties(dorian_OPS, {
    mocha_instance: {value: new mocha_module({ui: 'tdd', reporter: 'spec'})},
    function_blacklist: {value: ['send_email_to_team', 'fraudCheck']},
    callback_whitelist: {value: ['callback', 'next', 'cb']},
    arg_test_values: {value: [{}, [], 0, 1]},
    fn_slicer: {value: /(?:function\s\w+\(|function\s\()([^\)]+)\)/},
    fn_name_slicer: {value: /(?:function\s)(\w+)/},
    coverage_collector: {value: istanbul.Collector()},
    coverage_reporter: {value: istanbul.Report},
    walkTheTree: {
        value: function walkTheTree(exported_object, parent_key) {
            parent_key = parent_key || '';
            switch (typeof exported_object) {
                case 'function':
                    dorian_OPS.testFn(exported_object);
                    break;
                case 'object':
                    async.forEachOf(exported_object, function (val, key, callback) {
                        val && console.log('Inspecting object: %s.%s', parent_key, key)
                        dorian_OPS.walkTheTree(val, parent_key + '.' + key);
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
        }
    },
    testFn: {
        value: function testFn(exported_object) {
            var fn_declaration, fn_args, fn_name, test_matrix;
            fn_declaration = dorian_OPS.fn_slicer.exec(exported_object.toString());
            if (fn_declaration) {
                fn_args = fn_declaration[1].replace(/\s/g, '').split(',');
                fn_name = dorian_OPS.fn_name_slicer.exec(fn_declaration[0]);
                if (fn_name && dorian_OPS.function_blacklist.indexOf(fn_name[1]) != -1) {
                    return;
                }
                test_matrix = dorian_OPS.generateMatrix(fn_args);

                if (test_matrix.values.length > 0) {
                    async.each(test_matrix.values, function (fn_args) {
                        dorian_OPS.mocha_instance.suite.addTest(new mocha_module.Test(fn_declaration[0] + ' - handles - ' + JSON.stringify(fn_args), function (done) {
                            var test_wired_args,
                                fn_result;
                            if (test_matrix.hasCallback) {
                                test_wired_args = fill_callback_fn({
                                    matrix: fn_args,
                                    callback_arg_position: test_matrix.callback_arg_position
                                }, done);
                                assert.doesNotThrow(function () {
                                    try {
                                        fn_result = exported_object.bind(this, test_wired_args);
                                    } catch (err) {
                                        throw err;
                                    }
                                }, /.*/);
                            } else {
                                assert.doesNotThrow(function () {
                                    try {
                                        fn_result = exported_object.bind(this, fn_args);
                                        done();
                                    } catch (err) {
                                        throw err;
                                    }
                                }, /.*/);
                            }

                            if (fn_result) {
                                dorian_OPS.walkTheTree(fn_result);
                            }
                        }));
                    });
                } else {
                    mocha.suite.addTest(new mocha_module.Test(fn_declaration[0] + ' - handles - ' + JSON.stringify(fn_args), function (done) {
                        var test_wired_args = [],
                            fn_result;
                        if (test_matrix.hasCallback) {
                            test_wired_args = [callback_fn(done)];
                            assert.doesNotThrow(function () {
                                try {
                                    fn_result = exported_object.bind(this, test_wired_args);
                                } catch (err) {
                                    throw err;
                                }
                            }, /.*/);
                        } else {
                            assert.doesNotThrow(function () {
                                try {
                                    fn_result = exported_object.bind(this, fn_args);
                                    done();
                                } catch (err) {
                                    throw err;
                                }
                            }, /.*/);
                        }

                        if (fn_result) {
                            dorian_OPS.walkTheTree(fn_result);
                        }
                    }));
                }
            }
        }
    },
    callback_fn: {
        value: function callback_fn(done) {
            return function () {
                if (arguments) {
                    for (var idx = 0; idx < arguments.length; idx++) {
                        expect(typeof arguments[idx]).to.not.eq('error')
                        && arguments[idx]
                        && dorian_OPS.walkTheTree(arguments[idx]);
                    }
                }
                done();
            };
        }
    },
    fill_callback_fn: {
        value: function fill_callback_fn(options, done) {
            options.matrix.splice(options.callback_arg_position, 0, dorian_OPS.callback_fn(done));
            return options.matrix;
        }
    },
    generateMatrix: {
        value: function generateMatrix(fn_args) {
            /**
             This is used to detect a callback as one of the fn_params
             But this happens by arg name in a whitelist.  Which is kinda dumb.
             Do it better.
             */
            var callback_arg_position = -1,
                matrix = {};
            dorian_OPS.callback_whitelist.forEach(function (list_item) {
                if (callback_arg_position == -1) {
                    callback_arg_position = fn_args.indexOf(list_item);
                }
            });
            if (callback_arg_position == -1) {
                matrix.values = fn_args.length > 0 && cmbx.baseN(dorian_OPS.arg_test_values, fn_args.length).toArray();
            } else {
                matrix = {
                    values: cmbx.baseN(dorian_OPS.arg_test_values, fn_args.length - 1).toArray(),
                    hasCallback: true,
                    callback_arg_position: callback_arg_position,
                    wireCallback: dorian_OPS.fill_callback_fn
                };
            }
            return matrix;
        }
    },
    buildTestSuite: {
        value: function buildTestSuite() {
            var floor = dorian_workspace.multi_pass_generator.length;
            if (dorian_workspace.test_pass_incrementor == 0 || dorian_workspace.multi_pass_generator.length < 100) {
                floor = 0;
            } else {
                floor = dorian_workspace.multi_pass_generator.length - 100;
            }
            console.log('Building new test suite');
            while (dorian_workspace.multi_pass_generator.length > floor) {
                dorian_workspace.multi_pass_generator.pop()();
            }
        }
    },
    seeWhatBreaks: {
        value: function seeWhatBreaks() {
            module.parent.children.forEach(function (module) {
                if (module.filename.indexOf('node_modules') == -1
                    && module.filename.indexOf('dorian') == -1) {  //TODO: stupid hack while the module doesn't come from npm
                    dorian_workspace.internal_modules.push(module);
                }
            });

            dorian_workspace.internal_modules.forEach(function (app_module) {
                var exported_object = app_module.exports;
                dorian_OPS.walkTheTree(exported_object);
            });


            dorian_OPS.buildTestSuite();

            dorian_OPS.incrementalMochaRun(dorian_OPS.coverage_collector, function (failures) {
                var report = dorian_OPS.coverage_reporter.create('html');
                report.writeReport(dorian_OPS.coverage_collector, true, function () {
                    console.log('Generated report');
                });

                console.log('Tests ran: %s', dorian_OPS.mocha.suite.tests.length);
                console.log('Failures: %s', failures || 0);
                console.log('Dorian run successful');
            });
        }
    },
    incrementalMochaRun: {
        value: function incrementalMochaRun(collector, callback) {
            var mocha_instance = dorian_OPS.mocha_instance,
                coverage = global.__coverage__ = global.__coverage__ || {};

            setTimeout(function () {
                mocha = new mocha_module({
                    ui: 'tdd',
                    reporter: 'spec'
                });

                dorian_workspace.test_pass_incrementor++;
                console.log('Tests generated for pass (%s): %s', dorian_workspace.test_pass_incrementor, mocha_instance.suite.tests.length);
                console.log('Starting Mocha test run...');

                mocha_instance.run(function (failures) {
                    coverage.add(coverage);  // TODO: why isn't this a thing??
                    dorian_OPS.buildTestSuite();
                    if (dorian_OPS.mocha_instance.suite.tests.length > 0) {
                        dorian_OPS.incrementalMochaRun(collector, callback);
                    } else {
                        callback(failures);
                    }
                });
            }, 1000);
        }
    }
});

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
    test_pass_incrementor: 0

};

/**
 * export entry function to the consumers
 * @type {{run: (dorian_ops.seeWhatBreaks|Function)}}
 */
module.exports = {
    run: dorian_OPS.seeWhatBreaks
};
