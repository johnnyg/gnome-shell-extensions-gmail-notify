/*
 * Copyright (c) 2012 Adam Jabłooński
 *
 * Gmail Notify Extension is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by the
 * Free Software Foundation; either version 2 of the License, or (at your
 * option) any later version.
 *
 * Gmail Notify Extension is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
 * or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License
 * for more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with Gnome Documents; if not, write to the Free Software Foundation,
 * Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA
 *
 * Author: Adam Jabłoński <jablona123@gmail.com>
 *
 */
const Extension = imports.ui.extensionSystem.extensions["gmail_notify@jablona123.pl"];
const TlsConn=Extension.tlsconnection;
const Imap = Extension.imap;
const OAuth=Extension.oauth;
//const TlsConn=imports.tlsconnection;
//const Imap = imports.imap;
//const OAuth=imports.oauth;

const Signals=imports.signals;
const Lang=imports.lang;
const Soup=imports.gi.Soup;
const sess = new Soup.SessionAsync();
Soup.Session.prototype.add_feature.call(sess, new Soup.ProxyResolverDefault());



try {
	const Goa = imports.gi.Goa;
}
catch (err) {
	global.log("Goa import error:"+err.message);
}

const _DEBUG=false;


var GmailConnection = function () {
	this._init.apply(this,arguments);
}

GmailConnection.prototype = {
	__proto__: TlsConn.TlsConnection.prototype,
	_init : function (account) {
		try
		{
			if (account.get_account().provider_name.toUpperCase()!= "GOOGLE"){
				throw new Error('This is not Google Account')
			}
			this._oAccount=account;
			if (_DEBUG) global.log("Creating gmail conn .."+this._oAccount.get_account().id);
			this._oMail=this._oAccount.get_mail();
			TlsConn.TlsConnection.prototype._init.call(this,this._oMail.imap_host,this._oMail.imap_use_tls ? 993 : 143)
		}
		catch (err)
		{
			global.log("gmailConnection.proto:"+err.message);
		}
	}

};

//dummy class to emulate imap;

function GmailHttps() {
	this._init.apply(this,arguments);

};

GmailHttps.prototype = {
	_init : function (account) {
		this.connected=true;
		this._oAccount=account;
	},
	_disconnect : function () {
		this.connected=false;
		this.emit('disconnected');
	}
};

Signals.addSignalMethods(GmailHttps.prototype);

function GmailFeed () {
	this._init.apply(this,arguments);
};

GmailFeed.prototype= {
	_init : function (conn) {
		this.authenticated = true;
		this._conn=new GmailHttps(conn);
		this.folders=new Array();
	},
	scanInbox: function (callback) {
		try {
			if (_DEBUG) global.log('Entering scanInbox safe:');
			let folder = 'inbox';
			let host = 'mail.google.com';
			let service='https://'+host+"/mail/feed/atom/"+folder;
			let oAuth=new OAuth.OAuth(this._conn._oAccount,service);
			//let sess = new Soup.SessionAsync();
			let msg=Soup.Message.new("GET",service);
			if (_DEBUG) global.log('auth req'+oAuth.oAuth_auth);
			msg.request_headers.append('Authorization','OAuth '+oAuth.oAuth_auth);
			//msg.request_headers.append('host',host);
			if (_DEBUG) global.log('Queuing message:');
			var _call=callback;
			var _folder=folder;
			sess.queue_message(msg,Lang.bind(this,function(sess,msg,callback){
					if (_DEBUG) global.log('Message status:'+msg.status_code);
					if (msg.status_code==200){
						try {
							this.folders=new Array();
							let messages = new Array();
							let oxml = new XML(msg.response_body.data.substr(msg.response_body.data.indexOf('>')+1).replace('xmlns="http://purl.org/atom/ns#"',''));
							if (_DEBUG) global.log('xml created:'+oxml.toString());
							let i=0;
							let cnt=0;
							while(typeof(oxml.entry[i]) !='undefined') {
								let em = new Imap.ImapMessage();
								em.from=oxml.entry[i].author.name.toString()+' <'+oxml.entry[i].author.email.toString()+'>';
								if (_DEBUG) global.log('From::'+em.from);
								em.id = i;
								em.subject=oxml.entry[i].title.toString();
								if (_DEBUG) global.log('Message found:'+em.subject);
								em.date=oxml.entry[i].modified.toString();
								if (_DEBUG) global.log('date created:'+em.date.toString());
								em.link=oxml.entry[i].link.@href.toString();
								em.safeid=oxml.entry[i].id.toString();
								messages.push(em);
								cnt++;
								let j=0;
								while (typeof(oxml.entry[i].contributor[j])!='undefined')
								{
									let cm= new Imap.ImapMessage();
									cm.from=oxml.entry[i].contributor[j].name.toString()+' <'+oxml.entry[i].contributor[j].email.toString()+'>';
									if (_DEBUG) global.log('From contrib::'+cm.from);
									cm.id = i;
									cm.subject=oxml.entry[i].title.toString();
									cm.date=oxml.entry[i].modified.toString();
									cm.link=oxml.entry[i].link.@href;
									cm.safeid=oxml.entry[i].id.toString();
									messages.push(cm);
									j++;
									cnt++;
								}

								i++;
							}
							if (_DEBUG) global.log('Before push')
							this.folders.push(new Object({name:'inbox',encoded:'inbox',messages:cnt,unseen:cnt,list: messages }));
							if (_DEBUG) global.log('Before emit');
							this.emit('inbox-fed',folder);
							if (typeof(callback)!='undefined') callback.apply(this,[this,folder]);
						}
						catch (err) {
							global.log('Feed scaninbox queue message Error:'+err.message);
							this.emit('inbox-fed',folder,err);
							if (typeof(callback)!='undefined') callback.apply(this,[this,folder,err]);
						}
					}
					else
					{
						if (_DEBUG) global.log('Message body:'+msg.response_body.data);
						throw new Error('Google connection Status: '+msg.status+' '+msg.message_body.data);
					}


				}),callback);

		}
		catch (err) {
			 global.log('Feed scaninbox Error:'+err.message);
			 this.emit('inbox-fed',folder,err);
			 if (typeof(callback)!='undefined') callback.apply(this,[this,folder,err]);
		}

	}
};

Signals.addSignalMethods(GmailFeed.prototype);

function GmailImap () {
	this._init.apply(this,arguments);
};
GmailImap.prototype= {
	__proto__:Imap.Imap.prototype,
	_init : function (conn) {
		try {
		if (conn instanceof GmailConnection) {
			Imap.Imap.prototype._init.call(this,conn) ;
		}
		// must be goa object (account)
		else  {
			let oconn = new GmailConnection(conn);
			Imap.Imap.prototype._init.call(this,oconn) ;
			if (_DEBUG) global.log("Imap created: .."+this._conn._oAccount.get_account().id);
		}
		this.authenticated=false;
		this._conn.connect('disconnected',Lang.bind(this,function(){
			this.authenticated = false;
			}))
		}
		catch (err)
		{
			global.log("gmailImap.proto:"+err.message);
		}
	},
	readGreeting : function (callback) {
		this._readBuffer("",true,true,Lang.bind(this,function (oImap,resp) {
				if (resp[0].substr(2,2)=="OK") this.gmailConnected=true;
					this.emit('greeting-ready');
					if (typeof(callback) !=	'undefined') {
							callback.apply(this,[this,resp]);
					}
				} ));

	},

	authenticate: function(account,service,callback) {

	try {
		if (this._conn.connected)
		{
			this._doauthenticate(account,service,callback)
		}
		else
		{
			var _acc=account;
			var _svr=service;
			var _call=callback;
			this._conn._connect(Lang.bind(this,function () {
				this._doauthenticate(_acc,_svr,_call)
				}));
		}
		}
		catch (err) {
			global.log("authenticate: "+err.message)
		}
	},
	_doauthenticate : function (account,service,callback) {
		try {
		let oAuth=new OAuth.OAuth(account,service);
		let auth_str=oAuth.oAuth_str;
		this._command("AUTHENTICATE XOAUTH "+auth_str,false,Lang.bind(this,function (oGIMap,resp) {
					if (_DEBUG) {for (let i=0;i<resp.length;i++) global.log(resp[i]);}
					if (this._commandOK(resp)){
						this.authenticated=true;
						this._conn.newline=String.fromCharCode(13)+String.fromCharCode(10);
						if (typeof(callback) !=	'undefined') {
							callback.apply(this,[this,resp]);
						}
						this.emit('authenticated',true);
					}
					else {
						if (typeof(callback) !=	'undefined') {
							callback.apply(this,[this,resp,new Error('Authentication error')]);
						}
						this.emit('authenticated',false);
					}
				} )
		);
		}
		catch (err) {
			global.log("_doAuthenticate: "+err.message)
		}
	},
	scanInbox : function (callback) {

			try {
				if (_DEBUG) global.log ('scanInbox: Imap mode');
			if (this.authenticated ) {
				this._doScanInbox(callback);
			}
			else
			{
				var _call=callback;

					this.authenticate(this._conn._oAccount,"https://mail.google.com/mail/b/"+this._conn._oMail.imap_user_name+"/imap/",

					Lang.bind(this,function(){
					this._doScanInbox(_call);
				}))
			}
		}
		catch (err) {
			global.log("scanInbox: "+err.message)
		}

	},

	_doScanInbox: function (callback,i) {
		try {
		if (_DEBUG) global.log("doScan entry")
		this._scanFolder("INBOX",Lang.bind(this,function(oImap,resp,error){
						if (_DEBUG) global.log("doScan callback i=");
							try {
							if (typeof(callback) !=	'undefined') {
								if (typeof(error) == 'undefined')
								{
									callback.apply(this,[this,resp]);

								}
								else {

									callback.apply(this,[this,resp,error]);
								}

							}
							if (_DEBUG) global.log("doScan"+this.folders.length);

							this.emit('inbox-scanned',resp,error)
							}
							catch (err) {
								global.log("doScan :"+err.message)
							}
							}));
		}
		catch (err) {
			global.log("_doscanInbox: "+err.message)
		}
	}
};

Signals.addSignalMethods(GmailImap.prototype);
