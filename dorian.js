var cmbx = require('./lib/combinatorics').Combinatorics;
var mocha_frap = require('./lib/mocha_frap');
var expect = require('chai').expect;

var mocha = new mocha_frap({
    ui: 'tdd',
    reporter: 'spec'
});
/*
TODO: Need to be able to run mocha programatically. Take a look at a mocha run to see how suites are built.
TODO: See if we can build a mocha test suite, and run it programatically.
*/

var third_party_modules = [];
var internal_modules = [];
var arg_test_values = [undefined, null, ''];


module.parent.children.forEach(function(module){
    if (module.filename.indexOf('node_modules') != -1) {
        third_party_modules.push(module);
    } else {
        internal_modules.push(module);
    }
});

internal_modules.forEach(function(app_module){
    var exported_object = app_module.exports;
    switch (typeof exported_object){
        case 'function':
            //inspect fn args
            var fn_declaration = /(?:function \()([^\)]+)\)/g.exec(exported_object.toString());
            if (fn_declaration) {
                var fn_args = fn_declaration[1].replace(' ', '').split(',');

                var test_matrix = cmbx.baseN(arg_test_values, fn_args.length).toArray();

                var mocha_suite = mocha.addTest('testing.addTest', function (done) {
                    expect(true).to.be.true;
                    expect(false).to.be.true;
                    done();
                });
            }
            break;
        default:
            console.log('Unsupported module.exports type');
            break;
    };
    mocha.run(function(failures){
        if(failures) {
            console.log("Failures: %s", failures);
        } else {
            console.log("Module tests complete");
        }
    });
});

function runTests(exported_object, fn_declaration, test_matrix){
    describe(fn_declaration[0], function () {
        test_matrix.forEach(function (test_case) {
            it('Handles ' + test_case.toString(), function (done) {
                expect(exported_object.apply(null, test_case)).to.not.throw;
            });
        });
    });
}
