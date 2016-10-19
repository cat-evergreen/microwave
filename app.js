var express	= require('express');
var FS 		= require('fs');
var HTTPS	= require('https');
var URL		= require('url');
var YAML 	= require('yaml-js');



/* ---- global settings --- */
var CREDENTIALS_FILENAME = '.credentials';
var O_AUTHORIZE_PATH = '/oauth/authorize';
var O_TOKEN_PATH = '/oauth/token';

var CREST_SCOPES = [
	'characterAccountRead',
	//'characterAssetsRead',
	'characterBookmarksRead',
	//'characterCalendarRead',
	//'characterChatChannelsRead',
	//'characterClonesRead',
	//'characterContactsRead',
	//'characterContactsWrite',
	//'characterContractsRead',
	//'characterFactionalWarfareRead',
	//'characterFittingsRead',
	//'characterFittingsWrite',
	//'characterIndustryJobsRead',
	//'characterKillsRead',
	'characterLocationRead',
	//'characterLoyaltyPointsRead',
	//'characterMailRead',
	//'characterMarketOrdersRead',
	//'characterMedalsRead',
	'characterNavigationWrite',
	//'characterNotificationsRead',
	//'characterOpportunitiesRead',
	//'characterResearchRead',
	//'characterSkillsRead',
	//'characterStatsRead',
	//'characterWalletRead',
	//'corporationAssetsRead',
	//'corporationBookmarksRead',
	//'corporationContactsRead',
	//'corporationContractsRead',
	//'corporationFactionalWarfareRead',
	//'corporationIndustryJobsRead',
	//'corporationKillsRead',
	//'corporationMarketOrdersRead',
	//'corporationMedalsRead',
	//'corporationMembersRead',
	//'corporationShareholdersRead',
	//'corporationStructuresRead',
	//'corporationWalletRead',
	//'fleetRead',
	//'fleetWrite',
	//'publicData',
	//'remoteClientUI',
	//'structureVulnUpdate'
];

// default values, can be set in the credentials file to override
var CREDENTIALS = {
	redirect_uri : 'http://localhost:3120/crest/', // should be overriden
	port : 3120,
	crest_url : 'https://crest-tq.eveonline.com/',
	xml_api_url : 'https://api.eveonline.com/',
	login_url : 'https://login.eveonline.com/',
	image_url : 'https://imageserver.eveonline.com/'
};


/* ---- utility functions ---- */
function btoa(str) {
	return new Buffer(str.toString(), 'binary').toString('base64');
}
function atob(str) {
	return new Buffer(str.toString(), 'base64').toString('binary');
}


/* ---- auth/crest functions ---- */
function getCrestLoginUrl(state) {
	var result = URL.parse(CREDENTIALS.login_url)
	result.pathname = O_AUTHORIZE_PATH,
	result.query = {
		response_type : 'code',
		client_id : CREDENTIALS.client_id,
		redirect_uri : CREDENTIALS.redirect_uri,
		scope : CREST_SCOPES.join(' '),
		state : state
	};
	return URL.format(result);
}


/* ---- read credentials ---- */
FS.accessSync(CREDENTIALS_FILENAME, FS.R_OK); // Do we need this or can we assume that readFileSync will throw the same errors?
var creds = YAML.load(FS.readFileSync(CREDENTIALS_FILENAME));
if (typeof creds.client_id == 'string' || typeof creds.client_id == 'number'){
	CREDENTIALS.client_id = creds.client_id;
	if (typeof creds.client_secret == 'string' || typeof creds.client_secret == 'number') {
		var auth = creds.client_id + ':' + creds.client_secret;
		CREDENTIALS.authCode = btoa(auth);
	} else {
		throw 'Invalid or missing client_secret "' + creds.client_secret + '" in credentials file.';
	}
} else {
	throw 'Invalid or missing client_id "' + creds.client_id + '" in credentials file.';
}
if (typeof creds.redirect_uri == 'string') {
	CREDENTIALS.redirect_uri = creds.redirect_uri;
} else {
	console.warn('Parameter "redirect_uri" missing or invalid in credentials file. Will use default value instead.');
}
if (typeof creds.port == 'number') {
	CREDENTIALS.port = creds.port;
}
var configUrls = ['crest_url', 'xml_api_url', 'login_url', 'image_url'];
for (var i = 0; i < configUrls.length; i++) {
	var confUrl = configUrls[i];
	if (typeof creds[confUrl] == 'string') {
		CREDENTIALS[confUrl] = creds[confUrl];
	}
}

var app = express();


/* ---- server callbacks --- */
app.get('/', function(req, res) {
	var state = 198374; // TODO handle states with session id hashes
	res.send('<a href="' + getCrestLoginUrl(198374) + '">Log into EvE</a>'+
	'<br><a href="/char/">Character Info</a>'+
	'<br><a href="/read/location/">Character Location</a>'); // TODO
});

app.get('/crest/', function(req, res) {
//	if (myState != req.query.state) { // TODO handle states with session id hashes
//		res.send('Returned state "' + req.query.state + '" did not match internal state "' + myState + '".');
//	} else {
		var loginUrl = URL.parse(CREDENTIALS.login_url);
		var options = {
			method : 'POST',
			host : loginUrl.host,
			path : O_TOKEN_PATH,
			headers : {
				'Host' : loginUrl.host,
				'Authorization' : 'Basic ' + CREDENTIALS.authCode,
				'Content-Type': 'application/json'
			}
		};
		var callback = function(response) {
			var data = '';
			response.on('data', function (c) { data += c; });
			response.on('end', function () {
				var answer = JSON.parse(data);
				app.locals.authData = { // TODO use session storage instead
					access : answer['access_token'],
					refresh : answer['refresh_token']
				}
				res.send('Login successfull<br><a href="/">Return</a>'); // TODO
			});
		};
		var request = HTTPS.request(options, callback);
		var body = {
			'grant_type' : 'authorization_code',
			'code' : req.query.code
		};
		request.write(JSON.stringify(body));
		request.end();
//	}
});

app.get('/char/', function(req, res) {
	var loginUrl = URL.parse(CREDENTIALS.login_url);
	var options = {
		method : 'GET',
		host : loginUrl.host,
		path : '/oauth/verify',
		headers : {
			'Host' : loginUrl.host,
			'Authorization' : 'Bearer ' + app.locals.authData.access // TODO use session storage instead
		}
	};
	var callback = function(response) {
		var data = '';
		response.on('data', function (c) { data += c; });
		response.on('end', function () {
			var answer = JSON.parse(data);
			app.locals.charid = answer['CharacterID'];
			app.locals.charname = answer['CharacterName'];
			res.send(data); // TODO
		});
	};
	var request = HTTPS.request(options, callback);
	request.end();
});


/* ---- test callbacks ---- */
function getCrestReadOptions(requestUrl) {
	var parsedUrl = URL.parse(requestUrl);
	return {
		method : 'GET',
		hostname : parsedUrl.host,
		path : parsedUrl.pathname,
		headers : {
			'Host' : parsedUrl.host,
			'Authorization' : 'Bearer ' + app.locals.authData.access
		}
	};
}
var itemReadUrls = { // TODO use CREST walking to get those urls
	'location' : 'https://crest-tq.eveonline.com/characters/{charid}/location/',
	'decode' : 'https://crest-tq.eveonline.com/decode/',
	'chars' : 'https://crest-tq.eveonline.com/characters/{charid}/'
}
app.get('/read/:item', function(req, res) {
	var item = req.params.item;
	var readUrl = itemReadUrls[item];
	if (typeof readUrl == 'string') {
		readUrl = readUrl.replace('{charid}', app.locals.charid); // TODO use CREST walking to get those urls
		var options = getCrestReadOptions(readUrl);
		var callback = function(response) {
			var data = '';
			response.on('data', function (c) { data += c; });
			response.on('end', function () {
				var answer = JSON.parse(data);
				console.info(answer);
				res.send(data);
			});
		};
		var request = HTTPS.request(options, callback);
		request.end();
	} else {
		res.send('Item type "' + item + '" not found.');
	}
});

app.listen(CREDENTIALS.port, function() {
	console.log('Now listening on port ' + CREDENTIALS.port);
});