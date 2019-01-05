/*

ATTENTION: Ugly code incoming! <3

Limitation of liability:
This project only shows how to use the (unofficial) API of Genius.com in combination with the official Spotify API.
No liability is accepted for any claims, account suspensions, etc..

 */

// Change the port and url here
// Dont forget to change the socket port and url in 'views/index.pug'
const config = {
    url: 'http://127.0.0.1',
    webPort: 1359,
    socketPort: 1380
};

const SpotifyWebApi = require('spotify-web-api-node');
const express = require('express');
const app = express();
const request = require('request');
const io = require('socket.io')(config.socketPort);
const striptags = require('striptags');
const moment = require('moment');

var songText = '';
var songId = 0;
var songName = 'Unknown';
var additionalInfos = {
    coverURL: '',
    views: 0,
    updated: '',
    title: 'Unknown'
};
var ready = false;

var scopes = ['user-read-currently-playing', 'user-read-playback-state'],
    redirectUri = `${config.url}:${config.webPort}/live`,
    clientId = 'YOUR CLIENTID',
    clientSecret = 'YOUR SECRETKEY',
    state = '';

// Setting credentials can be done in the wrapper's constructor, or using the API object's setters.
var spotifyApi = new SpotifyWebApi({
    redirectUri: redirectUri,
    clientId: clientId,
    clientSecret: clientSecret,
});

io.on('connection', function (socket) {
    socket.emit('setSong', {id: songId, text: songText, infos: additionalInfos});
    socket.on('update', function () {
        socket.emit('setSong', {id: songId, text: songText, infos: additionalInfos});
    });
});

// Create the authorization URL
const authorizeURL = spotifyApi.createAuthorizeURL(scopes, state);
console.log(`Please visit: ${authorizeURL}`);

// Anonym source? #Stackoverflow
function replaceAllBackSlash(targetStr) {
    var index = targetStr.indexOf("\\");
    while (index >= 0) {
        targetStr = targetStr.replace("\\", "");
        index = targetStr.indexOf("\\");
    }
    return targetStr;
}

// Refresh song informations
function refreshSpotify() {
    spotifyApi.getMyCurrentPlaybackState({})
        .then(function (data) {
            if (songName === `${data.body.item.artists["0"].name} - ${data.body.item.name}`) {
                return;
            }

            console.log(`Now Playing: ${data.body.item.artists["0"].name} - ${data.body.item.name}`);

            songName = `${data.body.item.artists["0"].name} - ${data.body.item.name}`;
            request(`https://genius.com/api/search/multi?q=${encodeURIComponent(songName)}`, function (error, response, body) {
                if (error) throw error;

                if (response.statusCode === 200) {
                    body = JSON.parse(body);
                    if (body.response.sections['1'].hits['0'] === undefined) {
                        songText = `<strong>Lyrics not found:</strong> ${songName}`;
                        songId = 0;
                        return;
                    }
                    if (songId === body.response.sections['1'].hits['0'].result.id)
                        return;

                    additionalInfos.coverURL = body.response.sections['1'].hits['0'].result.song_art_image_thumbnail_url;
                    additionalInfos.views = body.response.sections['1'].hits['0'].result.stats.pageviews;
                    additionalInfos.updated = moment(body.response.sections['1'].hits['0'].result.lyrics_updated_at * 1000).startOf('day').fromNow();
                    additionalInfos.title = songName;

                    songId = body.response.sections['1'].hits['0'].result.id;

                    request(`https://genius.com/songs/${songId}/embed.js`, function (error, response, body) {
                        if (error) throw error;

                        if (response.statusCode === 200) {
                            let regex = /document\.write\(JSON.parse\((.*)<iframe/gm;
                            let m;

                            while ((m = regex.exec(body)) !== null) {
                                // This is necessary to avoid infinite loops with zero-width matches
                                if (m.index === regex.lastIndex) {
                                    regex.lastIndex++;
                                }
                                // The result can be accessed through the `m`-variable.
                                m.forEach((match, groupIndex) => {
                                    if (groupIndex === 1) {
                                        let toEdit = match;
                                        toEdit = striptags(toEdit, ['br']);
                                        let search = ['\'\\"\\ \\\\ \\ \\ Powered by Genius\\\\\\ \\ ', '\\n', '\\'];
                                        let replace = ['', '', ''];

                                        toEdit = toEdit.replace(search, replace);
                                        toEdit = toEdit.replace(/(\\r\\n|\\n|\\r)/gm, '');
                                        toEdit = replaceAllBackSlash(toEdit);
                                        toEdit = toEdit.replace('\'" ', '');
                                        toEdit = toEdit.replace('\'"', '');
                                        toEdit = toEdit.replace('Powered by Genius', '');
                                        songText = toEdit;
                                    }
                                });
                            }
                        }
                    });

                }
            });
        }, function (err) {
            console.log('Something went wrong!', err);
        });
}

app.set('view engine', 'pug');

app.get('/live', function (req, res) {
    if (req.query.code !== undefined) {
        if (!ready) {
            ready = true;
            spotifyApi.authorizationCodeGrant(req.query.code).then(
                function (data) {
                    spotifyApi.setAccessToken(data.body['access_token']);
                    spotifyApi.setRefreshToken(data.body['refresh_token']);
                    refreshSpotify();
                    setInterval(function () {
                        refreshSpotify()
                    }, 2500);
                },
                function (err) {
                    console.log('Something went wrong!', err);
                }
            );
        }
        res.send(`<meta http-equiv="refresh" content="2; URL=${config.url}:${config.webPort}/live">`);
    } else {
        res.render('index');
    }
});

app.listen(config.webPort, function () {
    console.log(`Server started on port ${config.webPort} - Socket.io on port ${config.socketPort}!`);
});
