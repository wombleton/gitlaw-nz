var async = require('async'),
    cheerio = require('cheerio'),
    _ = require('underscore'),
    fs = require('fs'),
    path = require('path'),
    request = require('request'),
    url = require('url'),
    md = require('html-md'),
    actQueue,
    searchQueue;

function scrapeSearch(uri, callback) {
    request({
        uri: uri
    }, function(err, response, body) {
        var $,
            href,
            acts;

        if (err) {
            console.err(err);
            process.exit(1);
        } else {
            $ = cheerio.load(body);
            href = $('.search-results-pagination li:last-child a').attr('href');

            if (href) {
                href = 'http://www.legislation.govt.nz' + href;
                console.log('Loading: ' + href);
                searchQueue.push(href);
            }

            acts = $('.resultsTitle a');

            _.each(acts, function(act) {
                var uri = url.parse(act.attribs['href']);

                uri.search = undefined;
                uri.pathname = uri.pathname.replace(/\/[^\/]+\.html$/, '/whole.html');

                actQueue.push('http://www.legislation.govt.nz' + url.format(uri));
            });

            callback();
        }
    });
}

function downloadAct(uri, callback) {
    request({
        uri: uri
    }, function(err, response, body) {
        var $,
            act,
            title,
            file,
            markdown,
            dir;

        if (err) {
            console.err('Couldn\'t download', uri);
        } else {
            $ = cheerio.load(body);

            act = $('.act').html();
            title = $('h1.title').text();
            markdown = md(act);

            file = path.join('acts', title.substring(0, 1).toUpperCase(), title);

            dir = path.dirname(file);

            fs.exists(dir, function(exists) {
                if (exists) {
                    writeFile(file, markdown, callback);
                } else {
                    fs.mkdir(path.dirname(file), function(err) {
                        if (err) {
                            console.log(err);
                            callback(err);
                        } else {
                            writeFile(file, markdown, callback);
                        }
                    });
                }
            });
        }
    });
}

function writeFile(file, markdown, callback) {
    fs.writeFile(file, markdown, function(err) {
        console.log("Written " + file);
        callback(err);
    });
}

searchQueue = async.queue(scrapeSearch);

actQueue = async.queue(downloadAct, 10);

searchQueue.push('http://www.legislation.govt.nz/act/results.aspx?search=ta_act_All_ac%40ainf%40anif_an%40bn%40rn_200_a&p=1');
