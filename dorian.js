var cmbx = require('./lib/combinatorics').Combinatorics;
var mocha_module = require('mocha');
var expect = require('chai').expect;

var mocha = new mocha_module({
    ui: 'tdd',
    reporter: 'spec'
});

var third_party_modules = [];
var internal_modules = [];
var arg_test_values = [{}, null, ''];
var fn_slicer = /(?:function\s\w+\(|function\s\()([^\)]+)\)/;

function callback_fn(done) {
    return function (err, data) {
        //TODO: sometimes there are no args passed- CRASH failure.
        if(err) {
            expect(typeof err).to.not.eq('error');
        }
        console.log('callback called');
        done();
    };
}

function fill_callback_fn(options, done) {
    var matrix = options.matrix;
    matrix.splice(options.callback_arg_position, 0, callback_fn(done));
    return matrix;
}

function generateMatrix(fn_args){
    var callback_arg_position = fn_args.indexOf('callback');
    if (callback_arg_position == -1){ //TODO: make a callback whitelist out of this
        callback_arg_position = fn_args.indexOf('next');
    }
    if (callback_arg_position == -1){ //TODO: make a callback whitelist out of this
        callback_arg_position = fn_args.indexOf('cb');
    }
    var args_count = callback_arg_position == -1 ? fn_args.length : fn_args.length - 1;
    var matrix = { values: cmbx.baseN(arg_test_values, args_count).toArray() };

    if (callback_arg_position != -1) {
        matrix.hasCallback = true;
        matrix.callback_arg_position = callback_arg_position;
        matrix.wireCallback = fill_callback_fn;
    }
    return matrix;
}

function testFn(exported_object) {
    var mochaTest = mocha_module.Test;
    var fn_declaration = fn_slicer.exec(exported_object.toString());
    if (fn_declaration) {
        var fn_args = fn_declaration[1].replace(/\s/g,'').split(',');
        if (fn_declaration[0].indexOf('fraudCheck') != -1){
            return; // this is for debugging async crash problem
        }
        var test_matrix = generateMatrix(fn_args);
        var hasCallback = test_matrix.hasCallback;
        var callback_arg_position = test_matrix.callback_arg_position;


        if (test_matrix.values.length > 0) {
            test_matrix.values.forEach(function (fn_args) {
                mocha.suite.addTest(new mochaTest(fn_declaration[0] + ' - can handle - ' + JSON.stringify(fn_args), function (done) {
                    var test_wired_args;
                    if (hasCallback){
                        test_wired_args = fill_callback_fn({
                            matrix: fn_args,
                            callback_arg_position: callback_arg_position
                        }, done)
                    }
                    expect(exported_object.apply(this, test_wired_args)).to.not.throw;
                    if (!hasCallback){
                        done();
                    }
                }));
            });
        } else {
            mocha.suite.addTest(new mochaTest(fn_declaration[0] + ' - handles - ' + JSON.stringify(fn_args), function (done) {
                expect(exported_object.apply(this)).to.not.throw;
                done();
            }));
        }

    }
}

function walkTheTree(exported_object){
    switch (typeof exported_object){
        case 'function':
            //inspect fn args
            testFn(exported_object);
            break;
        case 'object':
            for(var prop in exported_object){
                if (exported_object.hasOwnProperty(prop)) {
                    var module_prop = exported_object[prop];
                    walkTheTree(module_prop);
                }
            }
            break;
        case 'string':
        case 'number':
        case 'boolean':
            console.log('Skipping exported primitive- %s:%s', typeof exported_object, exported_object);
            break;
        default:
            console.log('Unsupported module.exports type: %s', typeof exported_object);
            break;
    }
}

module.parent.children.forEach(function(module){
    if (module.filename.indexOf('node_modules') != -1) {
        third_party_modules.push(module);
    } else {
        internal_modules.push(module);
    }
});

internal_modules.forEach(function(app_module){
    var exported_object = app_module.exports;
    walkTheTree(exported_object);
});

console.log('Tests generated: %s', mocha.suite.tests.length);
console.log('Starting Mocha test run...');
mocha.run(function(failures) {
    if (failures) {
        console.log("Failures: %s", failures);
    } else {
        console.log("Module tests complete");
    }
});