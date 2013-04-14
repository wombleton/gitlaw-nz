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
            console.log(err);
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
    // skip former title acts
    if (/formertitle\.aspx/.test(uri)) {
        return callback();
    }

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
            console.error("Couldn't download", uri, 'because', err);
            callback();
        } else {
            $ = cheerio.load(body);

            act = $('.act').html();
            title = $('h1.title').first().text().trim().replace(/\r\n?/g, ' ');

            markdown = makeMarkdown(act, uri);

            if (title) {
                file = path.join('acts', title.substring(0, 1).toUpperCase(), title);

                dir = path.dirname(file);

                fs.exists(dir, function(exists) {
                    if (exists) {
                        writeFile(file, markdown, callback);
                    } else {
                        fs.mkdir(path.dirname(file), function(err) {
                            writeFile(file, markdown, callback);
                        });
                    }
                });
            } else {
                console.log("COULD NOT FIND TITLE FOR: ", uri);
                callback();
            }
        }
    });
}

function makeMarkdown(act, uri) {
    var markdown = md(act);

    return markdown.replace(/(\n\[\d+\]: )([^\n]+)/g, function(match, number, pathname) {
        return number + url.resolve(uri, pathname);
    });
}

function writeFile(file, markdown, callback) {
    fs.writeFile(file, markdown, function(err) {
        if (err) {
            console.log("Problem writing this file: ", file, markdown.length, err);
        } else {
            console.log("Written " + file);
        }
        callback(err);
    });
}

searchQueue = async.queue(scrapeSearch);

actQueue = async.queue(downloadAct, 20);

searchQueue.push('http://www.legislation.govt.nz/act/results.aspx?search=ta_act_All_ac%40ainf%40anif_an%40bn%40rn_200_a&p=1');
