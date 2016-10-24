var CONNECT	= require('connect-sqlite3');
var EXPRESS	= require('express');
var SESSION	= require('express-session');
var FS 		= require('fs');
var HTTPS	= require('https');
var URL		= require('url');
var YAML 	= require('yaml-js');

var DB = require('./app_modules/database.js');
var UTIL = require('./app_modules/utils.js');

/* ---- global settings --- */
var CREDENTIALS_FILENAME = '.credentials';
var O_AUTHORIZE_PATH = '/oauth/authorize';
var O_TOKEN_PATH = '/oauth/token';
var O_VERIFY_PATH = '/oauth/verify';
var DB_DIR = './db';
var SESSIONS_DB = 'sessions';

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


/* ====== TEST STUFF ====== */
DB.testDB();

process.exit();

/* ---- read credentials ---- */
FS.accessSync(CREDENTIALS_FILENAME, FS.R_OK); // Do we need this or can we assume that readFileSync will throw the same errors?
var creds = YAML.load(FS.readFileSync(CREDENTIALS_FILENAME));
if (typeof creds.client_id == 'string' || typeof creds.client_id == 'number'){
	CREDENTIALS.client_id = creds.client_id;
	if (typeof creds.client_secret == 'string' || typeof creds.client_secret == 'number') {
		var auth = creds.client_id + ':' + creds.client_secret;
		CREDENTIALS.authCode = UTIL.btoa(auth);
	} else {
		throw 'Invalid or missing client_secret "' + creds.client_secret + '" in credentials file.';
	}
} else {
	throw 'Invalid or missing client_id "' + creds.client_id + '" in credentials file.';
}
if (typeof creds.cookie_secret == 'string' || typeof creds.cookie_secret == 'number') {
	CREDENTIALS.cookie_secret = creds.cookie_secret;
} else {
	throw 'Invalid or missing cookie_secret "' + creds.cookie_secret + '" in credentials file.';
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
delete creds;

var app = EXPRESS();
var SqliteStore = CONNECT(SESSION);
app.use(SESSION({
	resave : false,
	saveUninitialized : false,
	store : new SqliteStore({db : SESSIONS_DB, dir : DB_DIR}),
	secret : CREDENTIALS.cookie_secret,
	cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 1 week
}));

/* ---- server callbacks --- */
app.get('/', function(req, res) {
	var sess = req.session;
	var page = '<br><a href="/char/">Character Info</a>'
		+ '<br><a href="/read/location/">Character Location</a>'
		+ '<br><a href="/logout/">Logout</a>';
	if (sess.auth == undefined) {
		sess.auth = {
			state : UTIL.btoa(sess.id)
		}
		page = '<a href="' + getCrestLoginUrl(sess.auth.state) + '">Log into EvE</a>' + page;
	}
	res.send(page); // TODO
});

app.get('/logout', function(req, res) {
	req.session.destroy();
	res.send('Goodbye'); // TODO
});

app.get('/crest/', function(req, res) {
	var sess = req.session;
	console.info('session before auth')
	console.info(sess)
	if (sess.auth.state != req.query.state) {
		res.send('Returned state "' + req.query.state + '" did not match internal state "' + sess.auth.state + '".');
	} else {
		var loginUrl = URL.parse(CREDENTIALS.login_url);
		var options = {
			method : 'POST',
			host : loginUrl.host,
			path : O_TOKEN_PATH,
			headers : {
				'Host' : loginUrl.host,
				'Authorization' : 'Basic ' + CREDENTIALS.authCode, // TODO do we need the pure authCode somewhere else? 
				// If not we can make a getAuthCode function that will precalc the whole string including "Basic "
				'Content-Type': 'application/json'
			}
		};
		var callback = function(response) {
			var data = '';
			response.on('data', function (c) { data += c; });
			response.on('end', function () {
				var answer = JSON.parse(data);
				sess.auth.access = answer['access_token'];
				sess.auth.refresh = answer['refresh_token'];
				console.info('session after auth')
				console.info(sess)
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
	}
});

app.get('/char/', function(req, res) {
	var sess = req.session;
	console.info('session before char')
	console.info(sess)
	if (sess.charname != undefined) {
		res.send('Hello ' + sess.charname); // TODO
	} else {
		var loginUrl = URL.parse(CREDENTIALS.login_url);
		var options = {
			method : 'GET',
			host : loginUrl.host,
			path : O_VERIFY_PATH,
			headers : {
				'Host' : loginUrl.host,
				'Authorization' : 'Bearer ' + sess.auth.access
			}
		};
		var callback = function(response) {
			var data = '';
			response.on('data', function (c) { data += c; });
			response.on('end', function () {
				var answer = JSON.parse(data);
				sess.charid = answer['CharacterID'];
				sess.charname = answer['CharacterName'];
				res.send('Hello ' + sess.charname); // TODO
			});
		};
		var request = HTTPS.request(options, callback);
		request.end();
	}
});


/* ---- test callbacks ---- */
function getCrestReadOptions(requestUrl, sess) {
	var parsedUrl = URL.parse(requestUrl);
	return {
		method : 'GET',
		hostname : parsedUrl.host,
		path : parsedUrl.pathname,
		headers : {
			'Host' : parsedUrl.host,
			'Authorization' : 'Bearer ' + sess.auth.access
		}
	};
}
var itemReadUrls = { // TODO use CREST walking to get those urls
	'location' : 'https://crest-tq.eveonline.com/characters/{charid}/location/',
	'decode' : 'https://crest-tq.eveonline.com/decode/',
	'chars' : 'https://crest-tq.eveonline.com/characters/{charid}/'
}
app.get('/read/:item', function(req, res) {
	var sess = req.session;
	console.info('session before read')
	console.info(sess)
	var item = req.params.item;
	var readUrl = itemReadUrls[item];
	if (typeof readUrl == 'string') {
		readUrl = readUrl.replace('{charid}', sess.charid); // TODO use CREST walking to get those urls
		var options = getCrestReadOptions(readUrl, sess);
		var callback = function(response) {
			var data = '';
			response.on('data', function (c) { data += c; });
			response.on('end', function () {
				var answer = JSON.parse(data);
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
