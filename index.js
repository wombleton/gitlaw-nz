var async = require('async'),
    cheerio = require('cheerio'),
    _ = require('underscore'),
    fs = require('fs'),
    path = require('path'),
    request = require('request'),
    url = require('url'),
    md = require('html-md'),
    GitHub = require('github-api'),
    shagit = require('shagit'),
    github,
    repo,
    actQueue,
    searchQueue,
    retried = {},
    SEARCH_URL = 'http://www.legislation.govt.nz/act/results.aspx?search=ta_act_All_ac%40ainf%40anif_an%40bn%40rn_200_a&p=1';

github = new GitHub({
    token: process.env.GITHUB_TOKEN,
    auth: 'oauth'
});
repo = github.getRepo(process.env.USER, process.env.REPO);

function scrapeSearch(uri, callback) {
    console.log('Loading: ' + uri);
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

                actQueue.push({
                    title: title,
                    uri: 'http://www.legislation.govt.nz' + url.format(uri)
                });
            });

            href = $('.search-results-pagination li:last-child a').attr('href');

            if (href) {
                href = 'http://www.legislation.govt.nz' + href;
                actQueue.push({
                    search: true,
                    uri: href
                });
            } else {
                setTimeout(function() {
                    searchQueue.push(SEARCH_URL);
                }, 24 * 60 * 60 * 1000);
                console.log("Restarting scan in 24 hours.");
            }

            callback();
        }
    });
}

function getPath(title) {
    title = title.trim().replace(/\r\n?/g, ' ').replace(/\//g, '-');

    return path.join('acts', title.substring(0, 1).toUpperCase(), title) + '.md';
}

function downloadAct(task, callback) {
    var uri = task.uri;


    // skip former title acts
    if (/formertitle\.aspx/.test(uri)) {
        return callback();
    } else if (task.search) {
        searchQueue.push(uri);
        return callback();
    }

    console.log("Requesting %s with %d items still in the queue and %d workers.", uri, actQueue.length(), actQueue.concurrency);
    request({
        uri: uri
    }, function(err, response, body) {
        var $,
            act,
            title,
            file,
            path,
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
                path = getPath(title);
                repo.read('master', path, function(err, content, contentSha) {
                    var sha;

                    if (err) {
                        if (err === 'not found') {
                            updateAct(path, title, markdown, callback);
                        } else {
                            console.log("Error checking github: %s. Sleeping for an hour..", err);
                            setTimeout(function() {
                                callback(err)
                            }, 60 * 60 * 1000);
                        }
                    } else {
                        sha = shagit(markdown);
                        if (sha !== contentSha) {
                            updateAct(path, title, markdown, callback);
                        } else {
                            console.log("%s matches. Moving to next file.", path);
                            callback();
                        }
                    }
                });
            }
        }
    });
}

function updateAct(path, title, markdown, callback) {
    console.log("Updating %s to new content", path);
    repo.write('master', path, markdown, "New version for " + title, function(err) {
        if (err) {
            console.log("Error updating: %s", err);
        } else {
            console.log("Successfully updated %s", path);
        }
        callback(err);
    });
}

function makeMarkdown(act, uri) {
    var markdown = md(act);

    return markdown.replace(/(\n\[\d+\]: )([^\n]+)/g, function(match, number, pathname) {
        return number + url.resolve(uri, pathname);
    });
}

searchQueue = async.queue(scrapeSearch);

actQueue = async.queue(downloadAct, process.env.QUEUE_SIZE || 1);

searchQueue.push(SEARCH_URL);
