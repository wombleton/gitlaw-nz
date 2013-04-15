var async = require('async'),
    cheerio = require('cheerio'),
    _ = require('underscore'),
    fs = require('fs'),
    path = require('path'),
    request = require('request'),
    url = require('url'),
    md = require('html-md'),
    actQueue,
    searchQueue,
    retried = {};

_.each('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), function(letter) {
    try {
        fs.mkdirSync('acts/' + letter);
    } catch(e) {}
});

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
                var file,
                    title,
                    uri;

                act = $(act);

                title = act.text();
                uri = url.parse(act.attr('href'));

                uri.search = undefined;
                uri.pathname = uri.pathname.replace(/\/[^\/]+\.html$/, '/whole.html');

                file = getPath(title);

                fs.exists(file, function(exists) {
                    if (exists) {
                        actQueue.push({
                            title: title,
                            uri: 'http://www.legislation.govt.nz' + url.format(uri)
                        });
                        console.log(file + " already exists, putting at the end...");
                    } else {
                        actQueue.unshift({
                            title: title,
                            uri: 'http://www.legislation.govt.nz' + url.format(uri)
                        });
                    }
                });
            });

            callback();
        }
    });
}

function getPath(title) {
    title = title.trim().replace(/\r\n?/g, ' ').replace(/\//g, '-');

    return path.join('acts', title.substring(0, 1).toUpperCase(), title);
}

function downloadAct(task, callback) {
    var uri = task.uri;

    // skip former title acts
    if (/formertitle\.aspx/.test(uri)) {
        return callback();
    }

    console.log("Requesting " + uri + " with " + actQueue.length() + " items still in the queue.");
    request({
        timeout: 15000,
        uri: uri
    }, function(err, response, body) {
        var $,
            act,
            title,
            file,
            markdown,
            dir;

        if (err || Math.floor(response.statusCode / 100) !== 2) {
            console.error("Couldn't download " + uri + ' because ' + err);
            callback();
            if (!retried[uri]) {
                retried[uri] = true;
                actQueue.push(uri);
            }
        } else {
            $ = cheerio.load(body);

            act = $('.act').html();
            title = $('h1.title').first().text();

            markdown = makeMarkdown(act, uri);

            if (title) {
                file = getPath(title);

                dir = path.dirname(file);

                fs.exists(dir, function(exists) {
                    if (!exists) {
                        try {
                            fs.mkdirSync(path.dirname(file));
                        } catch(e) {}
                    }
                    writeFile(file, markdown, callback);
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
        callback();
    });
}

searchQueue = async.queue(scrapeSearch);

actQueue = async.queue(downloadAct, 5);

searchQueue.push('http://www.legislation.govt.nz/act/results.aspx?search=ta_act_All_ac%40ainf%40anif_an%40bn%40rn_200_a&p=1');
