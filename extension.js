/*
 * Copyright (c) 2012 Adam Jabłoński
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
const GLib = imports.gi.GLib;

const St = imports.gi.St;
try {
	const Gio = imports.gi.Gio;
}
catch (err) {
	global.log("Soup import error:"+err.message);
}
const Main = imports.ui.main;
const Tweener = imports.ui.tweener;
const Extension = imports.misc.extensionUtils.getCurrentExtension();
const Gmail = Extension.imports.gmail;
const Imap = Extension.imports.imap;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Signals = imports.signals;
const Gettext = imports.gettext.domain('gmail_notify');
const _ = Gettext.gettext;
const GConf=imports.gi.GConf;
const Utils=imports.misc.util;
const MessageTray = imports.ui.messageTray;
const PopupMenu = imports.ui.popupMenu;
const PanelMenu = imports.ui.panelMenu;

const Clutter=imports.gi.Clutter;
const CHECK_TIMEOUT = 300;
const GCONF_ACC_KEY="/apps/gmail_notify/accounts";
const GCONF_DIR="/apps/gmail_notify";
const _DEBUG=false;
const _version = "0.3.7";
const GMAIL_URI = "http://www.gmail.com";
const DEFAULT_MAIL_APP = 'thunderbird';


try {
	const Soup =  imports.gi.Soup;
	const sSes=new Soup.SessionAsync();
	Soup.Session.prototype.add_feature.call(sSes, new Soup.ProxyResolverDefault());
}
catch (err) {
	global.log("Soup import error:"+err.message);
}


try {
	const Goa = imports.gi.Goa;
}
catch (err) {
	global.log("Goa import error:"+err.message);
}


let box,text, button,event,browserCmd, extensionPath, currentPos, config, onetime, goaAccounts, sM , sU, numGoogle, nVersion, bText,safemode, instantCheckLoopID;



function onTimer()
{
	if (_DEBUG )global.log("onTimer");
	try {
	sM=0;
	sU=0;
	numGoogle=0;
	for (let i=0;i < goaAccounts.length;i++ )
	{
		if (_DEBUG )global.log("Running scan: "+i+" "+goaAccounts[i]._conn._oAccount.get_account().id);
		goaAccounts[i].scanInbox();
	}
		if (_DEBUG )global.log("Post oTimer: "+goaAccounts.length);
	}
	catch (err)
	{
		global.log("onTimer :"+err.message);
	}
	return true;
};
function oneTime()
{
	if (_DEBUG )global.log("oneTime");
	try {
		sM=0;
		sU=0;
		numGoogle=0;
		for (let i=0;i < goaAccounts.length;i++ )
		{
			if (_DEBUG )global.log("Running scan: "+i+" "+goaAccounts[i]._conn._oAccount.get_account().id);
			goaAccounts[i].scanInbox();
		}
		if (_DEBUG )global.log("Post oneTime "+goaAccounts.length);
	}
	catch (err) {
		global.log("oneTime :"+err.message);
	}
	return false;
};

function GmailNotificationSource() {
    this._init();
};

GmailNotificationSource.prototype = {
     __proto__:  MessageTray.Source.prototype,

    _init: function() {
        MessageTray.Source.prototype._init.call(this, _("New gmail message"));

        this._setSummaryIcon(this.createNotificationIcon());
        this._nbNotifications = 0;
    },

	notify: function(notification) {
        MessageTray.Source.prototype.notify.call(this, notification);

        this._nbNotifications += 1;

        // Display the source while there is at least one notification
        notification.connect('destroy', Lang.bind(this, function () {
            this._nbNotifications -= 1;

            if (this._nbNotifications == 0)
                this.destroy();
        }));
    },

    createNotificationIcon: function() {

        return Clutter.Texture.new_from_file(extensionPath+"/icons/gmail-icon48.png");
    }

};



function GmailNotification(source, content) {
    this._init(source, content);
};

GmailNotification.prototype = {
    __proto__: MessageTray.Notification.prototype,

    _init: function(source, content) {
		if (_DEBUG) global.log('entering notification');
		try {
        MessageTray.Notification.prototype._init.call(this, source,
            _("New mail from %s").format(content.from),null,
					{ customContent: true });
        this.expanded = true;
        this._table.add_style_class_name('multi-line-notification');
		let blayout= new St.BoxLayout({ vertical: false });
        let layout = new St.BoxLayout({ vertical: true });


        let label = new St.Label({ text: (Date(content.date)).toLocaleString(),
                                    style_class: "gmail-small-text"
                                });
        layout.add(label);
        let label1 = new St.Label({ text: content.subject });
        layout.add(label1);
        blayout.add(layout);
        this.addActor(blayout);
		}
		catch (err) {
			global.log('notification init error:'+err.message);
		}
    },

	_canExpandContent: function() {
       return true;
    },

    destroy: function() {

        MessageTray.Notification.prototype.destroy.call(this);
    }


};


function _mailNotify(content)
{
	try {
		let source = new GmailNotificationSource();
		Main.messageTray.add(source);

		for (let i=0;i<content.length;i++){
			let notification = new GmailNotification(source, content[i]);
			notification.setTransient(true);
			source.notify(notification);
		}
	}
	catch (err) {
		global.log("_mail notify:"+err.message);
		button.text.text=err.message;
	}

};

function _processData(oImap,resp,error) {
		if (_DEBUG )global.log("Entering process Data ");
		if (_DEBUG )global.log("Process Data " + oImap._conn._oAccount.get_account().id);
		try
		{
					let maxId=0;
					let maxSafeId='';
					for (let i=0;i<oImap.folders.length;i++){
						sU+=oImap.folders[i].unseen;
						sM+=oImap.folders[i].messages;
						for (let j=0;j<oImap.folders[i].list.length;j++){
							if (oImap.folders[i].list[j].id>maxId) maxId=oImap.folders[i].list[j].id;
							if (oImap.folders[i].list[j].safeid>maxSafeId) maxSafeId=oImap.folders[i].list[j].safeid;
						}
					}
					if (_DEBUG )global.log("maxSafeId= " +maxSafeId);
					if (_DEBUG )global.log("total= " +sM);
					if (_DEBUG )global.log("unseen= " +sU);
					if (_DEBUG )global.log("Getting entry for  " + oImap._conn._oAccount.get_account().id);
					let entry=config.get_int(GCONF_ACC_KEY+"/"+oImap._conn._oAccount.get_account().id);
					let safeentry=config.get_string(GCONF_ACC_KEY+"/"+oImap._conn._oAccount.get_account().id+'_safe');
					entry= typeof(entry) !='undefined' && entry!=null ? entry : 0;
					safeentry= typeof(safeentry) !='undefined'  && safeentry!=null ? safeentry : '';
					if (_DEBUG )global.log("safeentry= " +safeentry);
					if (_DEBUG )global.log("entry= " +entry)

					if (config._safemode==1 ? maxSafeId>safeentry : maxId>entry){
						for (let i=0;i<oImap.folders.length;i++){
							var notes=new Array();
							for (let j=0;j<oImap.folders[i].list.length;j++){
								if (config._safemode==1)
								{
									if (oImap.folders[i].list[j].safeid>safeentry){
										notes.push(oImap.folders[i].list[j]);
									}
								}
								else
								{
									if (oImap.folders[i].list[j].id>entry){
										notes.push(oImap.folders[i].list[j]);
									}
								}
							}
							if (notes.length>0 && config._notify) {
								_mailNotify(notes);
							}

						}
						if (config._safemode==1)
						{
							config.set_string(GCONF_ACC_KEY+"/"+oImap._conn._oAccount.get_account().id+'_safe',maxSafeId);
						}
						else
						{
							config.set_int(GCONF_ACC_KEY+"/"+oImap._conn._oAccount.get_account().id,maxId);
						}
					}
					//todo:get not only from inbox
					if (_DEBUG) {
						global.log("Num google:"+numGoogle);
						global.log("Setting Content 0:"+oImap.folders[0].list.length);
						global.log("Setting Content 1:"+oImap._conn._oAccount.get_account().identity);
					}

					button.setContent(oImap.folders[0].list,numGoogle,oImap._conn._oAccount.get_account().identity);
					oImap._conn._disconnect();
					numGoogle++;
					button.text.clutter_text.set_markup(config._safemode ? ('%s').format(sM.toString()) :bText.format(sM.toString(),sU.toString()));
					button.setIcon(sU);
		}
		catch (err) {
			global.log("process data:"+err.message);
			button.text.text= err.message;
		}
		if (_DEBUG )global.log("Post Process Data " + oImap._conn._oAccount.get_account().id);
};

function _initData() {

	if (_DEBUG )global.log("Init data");
	try {
		goaAccounts= [];
		let aClient=Goa.Client.new_sync (null);
		let accounts = aClient.get_accounts();

		if (_DEBUG) global.log("init data");

		for (let i=0; i < accounts.length; i++)
		{
			if (_DEBUG ) global.log(accounts[i].get_account().provider_name.toUpperCase());
			if (_DEBUG ) global.log(accounts[i].get_account().id);
			if ( accounts[i].get_account().provider_name.toUpperCase()== "GOOGLE")
			{
				if (_DEBUG ) global.log("Post oneTime adding");
				let len=goaAccounts.push( config._safemode==1 ? new Gmail.GmailFeed(accounts[i]) : new Gmail.GmailImap(accounts[i]) );
				//let len=goaAccounts.push( new Gmail.GmailImap(accounts[i]) );
				goaAccounts[len-1].connect('inbox-scanned',_processData);
				goaAccounts[len-1].connect('inbox-fed',_processData);
				if (_DEBUG ) global.log("Post oneTime added:" + goaAccounts[i]._conn._oAccount.get_account().id );
			}
		}

		if (_DEBUG)
		{
			for (let i=0;i < goaAccounts.length;i++)
			{
				global.log("Checking Accounts" + goaAccounts[i]._conn._oAccount.get_account().id );
			}
		}

	if (_DEBUG ) global.log("Post Init data l:"+goaAccounts.length);
	}
	catch (err) {
		if (_DEBUG )global.log("Init data : "+err.message);
	}

};


// well run reader really
function _showHello(object,event) {

	try {
		if (config._reader==0) {
            try{
                let uri = ((object.link instanceof String) && object.link.length > GMAIL_URI.length)?object.link:GMAIL_URI;
                //Length of the link should not less than GMAIL_URI's
			    Utils.trySpawnCommandLine("gnome-open %s".format(uri));
            }catch(err){
                global.log(err.message);
            }
			
		} else {
			if (config._mail =="") {
				global.log("gmail notify: no default mail reader")
			}
			else {
			 Utils.trySpawnCommandLine(config._mail);
			}
		}
		
		if (object instanceof GmailMenuItem)
		    instantCheckLoopID = GLib.timeout_add_seconds(0,20, oneTime); //this should automatically remove 

	}
	catch (err) {
		global.log("Show Hello:"+err.message);
		button.text.text=err.message;
	}
};

function _browseGn() {
	Utils.trySpawnCommandLine("gnome-open %s".format(Extension.metadata["uri"]));
};
//
//GmailButton
//

function GmailButton() {
    this._init();
};

GmailButton.prototype = {
    __proto__: PanelMenu.Button.prototype,

    _init: function() {
		try {
        PanelMenu.Button.prototype._init.call(this, 0.0);
        this._label = new St.Bin({ style_class: 'panel-button', reactive: true,
                          can_focus: true,
                          x_fill:true,
                          y_fill: false,
                          track_hover:true
                          });
        this._box = new St.BoxLayout();

        this._icon_gray=Clutter.Texture.new_from_file(extensionPath+"/icons/gmaillogo-notifier-gray.svg");
		this._icon_red=Clutter.Texture.new_from_file(extensionPath+"/icons/gmaillogo-notifier-red.svg");
		this._icon = this._icon_gray;
		this._box.insert_child_at_index(this._icon_gray,1);
		this._box.insert_child_at_index(this._icon_red,1);
		this.text = new St.Label({text: "0(0)" });
		this.etext = new St.Label({text: ""});
		this._box.insert_child_at_index(this.text,2);
		this._box.insert_child_at_index(this.etext,3);
		this._label.set_child(this._box);

        this.actor.add_actor(this._label);
		} catch (err) {
			global.log("Button init"+ err.message);
		}

    },

	showNumbers : function (show) {
		try {
		if (show==0	){

			 this.text.hide();
			 this.etext.show();
		 }
		 else {

			 this.text.show();
			 this.etext.hide();
			 }
		}
		catch (err) {
			global.log("Show NUmbers"+ err.message);
		}

	},
	_showNoMessage : function() {
		if (_DEBUG) global.log("Gmail set content: no message");
		try {
			let note=new Imap.ImapMessage();
			note.date=new Date();
			note.subject=_('No new messages');
			let msg = new GmailMenuItem(note,{reactive: true
                           });
			msg.connect('activate', _showHello);
			this.menu.addMenuItem(msg,0);
			this.msgs.push(msg)
		} catch (err) {
			global.log(err.message);
		}
	},
	_showError : function(err) {
		if (_DEBUG) global.log("_showError: no message");
		try {
			let note=new Imap.ImapMessage();
			note.date=new Date();
			note.subject=_(err);
			let msg = new GmailMenuItem(note,{reactive: true
                           });
			msg.connect('activate', _browseGn);
			this.menu.addMenuItem(msg,0);
			this.msgs.push(msg)
		} catch (err) {
			global.log(err.message);
		}
	},
	_onButtonPress: function(actor, event) {
		if (_DEBUG) global.log("Button pres"+ event.get_button().toString());
		if (event.get_button()==1){
			try {
			if (!this.menu.isOpen) {
            	let monitor = Main.layoutManager.primaryMonitor;
				this.menu.actor.style = ('max-height: ' +
                                     Math.round(monitor.height - Main.panel.actor.height) +
                                     'px;');
			}
			if (this.submenu !=null && typeof(this.submenu)!='undefined'){
				this.submenu.destroy();
			}
			this._createSettings();
			this.menu.toggle();
			}
			catch (err) {
				global.log("onButtonPress"+ err.message);
			}

		}
		else {
			onTimer();
		}
    },
    _onDestroy: function() {},

    setIcon : function (n) {

		if ( n >0 || nVersion > _version )
		{
			this._icon=this._icon_red.show();
			this._icon=this._icon_gray.hide();
		}
		else
		{
			this._icon=this._icon_gray.show();
			this._icon=this._icon_red.hide();
		}

	},
	_createSettings : function () {
		try {
		this.submenu = new PopupMenu.PopupSubMenuMenuItem(_('Settings'));

		this.menu.addMenuItem(this.submenu);
		this.oReader = new PopupMenu.PopupSwitchMenuItem(_("Use default email client instead of browser"));
		this.oReader.setToggleState(config._reader);
		this.oReader.connect('toggled',Lang.bind(this,function(object,_value){
					try {
						config.set_int(GCONF_DIR+'/reader',_value ? 1 :0);
					}
					catch (err){
						global.log(err.message);
					}
						return true;
						}));
		this.oNotify = new PopupMenu.PopupSwitchMenuItem(_("Notify about incoming mail"));
		this.oNotify.setToggleState(config._notify);
		this.oNotify.connect('toggled',Lang.bind(this,function(object,_value){
					try {
						config.set_int(GCONF_DIR+'/notify',_value ? 1 :0);
					}
					catch (err){
						global.log(err.message);
					}
						return true;
						}));
		this.oNumbers = new PopupMenu.PopupSwitchMenuItem(_("Show email summary"));
		this.oNumbers.setToggleState(config._numbers);
		this.oNumbers.connect('toggled',Lang.bind(this,function(object,_value){
					try {
						if (_DEBUG) global.log("Numbers toggled value:"+_value );
						config.set_int(GCONF_DIR+'/numbers',_value ? 1 :0);
					}
					catch (err){
						global.log(err.message);
					}
						return true;
						}));
	    this.oVersion = new PopupMenu.PopupSwitchMenuItem(_("Check for new versions on startup"));
		this.oVersion.setToggleState(config._vcheck);
		this.oVersion.connect('toggled',Lang.bind(this,function(object,_value){
					try {
						if (_DEBUG) global.log("Versions toggled value:"+_value );
						config.set_int(GCONF_DIR+'/vcheck',_value ? 1 :0);
					}
					catch (err){
						global.log(err.message);
					}
						return true;
						}));

		this.oSafe = new PopupMenu.PopupSwitchMenuItem(_("Safe mode"));
		this.oSafe.setToggleState(config._safemode);
		this.oSafe.connect('toggled',Lang.bind(this,function(object,_value){
					try {
						if (_DEBUG) global.log("Versions toggled value:"+_value );
						config.set_int(GCONF_DIR+'/safemode',_value ? 1 :0);
					}
					catch (err){
						global.log(err.message);
					}
						return true;
						}));

		this.oTmText = new PopupMenu.PopupMenuItem(_("Check every {0} sec: ").replace('{0}',config._timeout.toString()));
		this.slabel= new St.BoxLayout({ vertical: false });
		this.oTimeout = new PopupMenu.PopupSliderMenuItem(0);
		this.oTmText.addActor(this.slabel);
		this.slabel.add(this.oTimeout.actor);
		this.oTimeout.setValue((config._timeout-60)/1740 ); //60 sec to 1800
		this.oTimeout.connect('value-changed',Lang.bind(this,function(object,_value){
					try {
						if (_DEBUG) global.log("val:"+_value);
						this.oTmText.label.text = _("Check every {0} sec: ").replace('{0}',Math.round(1740*_value+60).toString());
					}
					catch (err){
						global.log(err.message);
					}
						return true;
						}));
		this.oTimeout.connect('drag-end',Lang.bind(this,function(object){
			try {
			config.set_int(GCONF_DIR+'/timeout',Math.round(1740*this.oTimeout.value+60));
			} catch (err) {
				global.log(err.message);
			}
			return true;
			 }));
		//this.oTimeout.connect('value-changed',Lang.bind(this,function(_value){ this.oTmText.label.text="sdsdsd"; return true;}));

		this.cBase = new PopupMenu.PopupMenuItem(_("Extension position"));
		this.clabel= new St.BoxLayout({ vertical: false });
        this.oPosition = new PopupMenu.PopupComboBoxMenuItem({});
        this.cBase.addActor(this.clabel);
        this.clabel.add(this.oPosition.actor);

        let item;
        item = new PopupMenu.PopupMenuItem(_("Right"));
        this.oPosition.addMenuItem(item, 0);
        item = new PopupMenu.PopupMenuItem(_("Center"));
        this.oPosition.addMenuItem(item, 1);
        item = new PopupMenu.PopupMenuItem(_("Left"));
        this.oPosition.addMenuItem(item, 2);

        this.oPosition.setActiveItem(config._position);
        //this._combo.connect('active-item-changed',
        //                    Lang.bind(this, this._changeIMStatus));

        this.oPosition.connect('active-item-changed',Lang.bind(this,function(object,pos){
			try {
			config.set_int(GCONF_DIR+'/position',pos);
			} catch (err) {
				global.log(err.message);
			}
			return true;
		 }));

		this.submenu.menu.addMenuItem(this.cBase)  ;
		this.submenu.menu.addMenuItem(this.oReader)  ;
		this.submenu.menu.addMenuItem(this.oNotify)  ;
		this.submenu.menu.addMenuItem(this.oNumbers)  ;
		this.submenu.menu.addMenuItem(this.oTmText)  ;
		this.submenu.menu.addMenuItem(this.oVersion)  ;
		this.submenu.menu.addMenuItem(this.oSafe)  ;
		//this.submenu.menu.addMenuItem(this.oTimeout)  ;
	} catch (err) {
		global.log(err.message)
	}
	}

};

GmailButton.prototype.setContent=function (content,add,mailbox) {
		add = typeof(add) == 'undefined' ? 0 : add;
		mailbox = typeof(mailbox) == 'undefined' ? '' : mailbox;
	    try {
		if (_DEBUG) global.log("Gmail set content: 1");
		if (add == 0) {
			Main.panel._menus.removeMenu(this.menu);
			this.menu.destroy();
			this.menu = new PopupMenu.PopupMenu(this.actor, 0.0, St.Side.TOP);
			this.menu.actor.add_style_class_name('panel-menu');
			this.menu.connect('open-state-changed', Lang.bind(this, this._onOpenStateChanged));
			this.menu.actor.connect('key-press-event', Lang.bind(this, this._onMenuKeyPress));
			Main.uiGroup.add_actor(this.menu.actor);
			this.menu.actor.hide();
			this.msgs=new Array();
			this.boxes=new Array();
		}
		if (_DEBUG) global.log("Gmail set content: 2");
		if (typeof(content) != 'undefined'){
			if (_DEBUG) global.log("Gmail set content: 3");

			if (content.length>0){

				if (_DEBUG) global.log("Gmail set content: 4");
				for (let k=0;k<Math.min(content.length,10);k++){
					let msg = new GmailMenuItem(content[k],{reactive: true
                           });
					msg.connect('activate', _showHello);
					this.menu.addMenuItem(msg,0);
					this.msgs.push(msg);
				}
			}
			else {

				this._showNoMessage();
			}
			let mbox=new MailboxMenuItem(mailbox);
			mbox.connect('activate', _showHello);
			this.boxes.push(mbox);
			this.menu.addMenuItem(mbox,0);
		}
		else {
				this._showNoMessage();
		}
		if (nVersion > _version ) {
			let note=new Imap.ImapMessage();
			note.date=new Date();
			note.from = "Gmail Notify";
			note.subject=_('There is newer version of this extension: %s - click to download').format(nVersion);
			let msg = new GmailMenuItem(note,{reactive: true
                           });
			msg.connect('activate', _browseGn);
			this.menu.addMenuItem(msg);

		}
        this.sep = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this.sep);
        if (add==0) {
			this._createSettings();
		}

		} catch (err) {
			global.log("Gmail set content:"+err.message)
		}
		Main.panel._menus.addMenu(this.menu);
};


function GmailMenuItem() {
    this._init.apply(this, arguments);
};

GmailMenuItem.prototype = {
    __proto__: PopupMenu.PopupBaseMenuItem.prototype,

    _init: function (content, params) {
		try {
        PopupMenu.PopupBaseMenuItem.prototype._init.call(this, params);

        this.label= new St.BoxLayout({ vertical: false });
        let layout = new St.BoxLayout({ vertical: true });

        // Display avatar

        let iconBox = new St.Bin({ style_class: 'gmail-mailbox-avatar-box' });
        ///iconBox._size = 48; //It seems there is no difference whether we set this.

        iconBox.child = Clutter.Texture.new_from_file(extensionPath+"/icons/gmail-icon32.png");
        this.label.add(iconBox);

        // subscription request message


        let dts='';
        try {
			let dt=new Date(content.date);
			dts+=dt.getFullYear().toString()+"-"+(dt.getMonth()+1).toString()+"-"+
				dt.getDate().toString()+" "+dt.getHours().toString()+":"+dt.getMinutes().toString();
		}
		catch (err) {
			global.log('Date converison error in gmail menu item proto');
		}
		dts+=" "+content.from;
        let label = new St.Label({ text: dts,style_class:"gmail-dts"});
        if (_DEBUG) global.log('dts added');
        layout.add(label);
        let subtext='';
        this.link=content.link;
        try
        {
			subtext+=content.subject.length >50 ?  content.subject.substr(0,50)+'...' : content.subject;
		}
		catch (err){
			global.log('Subject converison error in gmail menu item proto'+err.message);
		}
        let label1 = new St.Label({ text:  subtext });
        layout.add(label1);
        this.label.add(layout);

        this.addActor(this.label);
	}
	catch (err) {
		global.log("GmailMenuItem proto error "+err.message);
		}
    }


};


function MailboxMenuItem() {
    this._init.apply(this, arguments);
};

MailboxMenuItem.prototype = {
    __proto__: PopupMenu.PopupBaseMenuItem.prototype,

    _init: function (text, params) {
		try {
        PopupMenu.PopupBaseMenuItem.prototype._init.call(this, params);
        this.label= new St.BoxLayout({ vertical: false });
        let iconBox = new St.Bin({ style_class: 'gmail-main-avatar-box' });
        iconBox._size = 48;
        iconBox.child = Clutter.Texture.new_from_file(extensionPath+"/icons/mailbox.png");
        this.label.add(iconBox);
        let mailbox = new St.Label({ text: text,style_class:"gmail-mailbox"});
        this.label.add(mailbox);
        this.addActor(this.label);
		}
		catch (err) {
			global.log("Mailbox Menu item Init:"+err.message);
		}
    }


};



var GmailConf=function () {
	this._init();
};
GmailConf.prototype = {
	_init : function () {
		try {
			this._client = GConf.Client.get_default();

			//some value init
			try {
			  this._mail=Gio.app_info_get_default_for_uri_scheme("mailto").get_executable();
			}
			catch (err) {
			    this._mail=DEFAULT_MAIL_APP;
				global.log("Config init mail : "+err.message);
			}
			let ival,sval;
			ival=this._client.get(GCONF_DIR+'/timeout');
			if (ival==null || typeof(ival)=='undefined') {
				this._client.set_int(GCONF_DIR+'/timeout',CHECK_TIMEOUT);
			}

			ival=this._client.get(GCONF_DIR+'/reader');
			if (ival==null || typeof(ival)=='undefined') {
				this._client.set_int(GCONF_DIR+'/reader',0);

			}
			ival=this._client.get(GCONF_DIR+'/position');
			if (ival==null || typeof(ival)=='undefined') {
				this._client.set_int(GCONF_DIR+'/position',0);

			}
			ival=this._client.get(GCONF_DIR+'/numbers');
			if (ival==null || typeof(ival)=='undefined') {
				this._client.set_int(GCONF_DIR+'/numbers',1);

			}
			ival=this._client.get(GCONF_DIR+'/notify');
			if (ival==null || typeof(ival)=='undefined') {
				this._client.set_int(GCONF_DIR+'/notify',1);
			}
			ival=this._client.get(GCONF_DIR+'/vcheck');
			if (ival==null || typeof(ival)=='undefined') {
				this._client.set_int(GCONF_DIR+'/vcheck',1);
			}
			ival=this._client.get(GCONF_DIR+'/safemode');
			if (ival==null || typeof(ival)=='undefined') {
				this._client.set_int(GCONF_DIR+'/safemode',1);
			}
			sval=this._client.get_string(GCONF_DIR+'/btext');
			if (sval=="" || sval==null || typeof(sval)=='undefined') {
				this._client.set_string(GCONF_DIR+'/btext',"%s(<u>%s</u>)");
			}
			this._notify=this._client.get_int(GCONF_DIR+'/notify');
			this._numbers=this._client.get_int(GCONF_DIR+'/numbers');
			this._position=this._client.get_int(GCONF_DIR+'/position');
			this._reader=this._client.get_int(GCONF_DIR+'/reader');
			this._timeout=this._client.get_int(GCONF_DIR+'/timeout');
			this._vcheck=this._client.get_int(GCONF_DIR+'/vcheck');
			this._btext=this._client.get_string(GCONF_DIR+'/btext');
			this._safemode=this._client.get_int(GCONF_DIR+'/safemode');

			//event binding
			this._client.add_dir(GCONF_DIR,GConf.ClientPreloadType.PRELOAD_RECURSIVE);
			this.np=this._client.notify_add(GCONF_DIR,Lang.bind(this,this._onNotify),this,Lang.bind(this,this._onDestroy));
			this.pid=this._client.connect('value-changed',Lang.bind(this,this._onValueChanged));

		}
		catch (err) {
			global.log("Config init: "+err.message);
		}

	},

	_readValues : function() {
		this._timeout=this._client.get_int(GCONF_DIR+'/timeout');
		this._reader=this._client.get_int(GCONF_DIR+'/reader');
		this._position=this._client.get_int(GCONF_DIR+'/position');
		this._numbers=this._client.get_int(GCONF_DIR+'/numbers');
		this._notify=this._client.get_int(GCONF_DIR+'/notify');
		this._vcheck=this._client.get_int(GCONF_DIR+'/vcheck');
		this._btext=this._client.get_string(GCONF_DIR+'/btext');
		this._safemode=this._client.get_int(GCONF_DIR+'/safemode');
	},
	set_int : function (key,val){
		return this._client.set_int(key,val)
	},
	get_int : function (key){
		return this._client.get_int(key)
	},
	set_string : function (key,val){
		return this._client.set_string(key,val)
	},
	get_string : function (key){
		return this._client.get_string(key)
	},
	_onNotify : function (client,object,p0) {

		return true;
	},
	_onDestroy : function (client,object,p0) {

		return true;
	},
	_onValueChanged : function (client,key,p0) {
		try {
		if (_DEBUG) global.log("Value change: "+key);
		switch (key) {
			case GCONF_DIR+'/position' :

				hide();
				this._position=this._client.get_int(GCONF_DIR+'/position');
				show();
				break;
			case GCONF_DIR+'/timeout' :

				this._timeout=this._client.get_int(GCONF_DIR+'/timeout');
				let ret=Mainloop.source_remove(event);
				event=null;
				event = GLib.timeout_add_seconds(0,this._timeout, onTimer);

				break;
			case GCONF_DIR+'/reader' :
				this._reader=this._client.get_int(GCONF_DIR+'/reader');
				break;
			case GCONF_DIR+'/numbers' :
				this._numbers=this._client.get_int(GCONF_DIR+'/numbers');
					button.showNumbers(this._numbers);
				break;
			case GCONF_DIR+'/safemode' :
				this._safemode=this._client.get_int(GCONF_DIR+'/safemode');
					_initData();
				break;
			case GCONF_DIR+'/notify' :
				this._notify=this._client.get_int(GCONF_DIR+'/notify');
				break;
			case GCONF_DIR+'/btext' :
				this._btext=this._client.get_string(GCONF_DIR+'/btext');
				bText=this._btext ;
				break;
			case GCONF_DIR+'/vcheck' :
				this._vcheck=this._client.get_int(GCONF_DIR+'/vcheck');
				if ( this._vcheck ==1) {
					_checkVersion();
				}
				break;
		}
		} catch (err) {
			global.log("onValueChange:" + err.message);
		}
		return true;
	},
	_disconnectSignals: function() {
		this._client.notify_remove(this.np);
		this._client.remove_dir(GCONF_DIR);
		this._client.disconnect(this.pid);

	}

}

//Signals.addSignalMethods(GmailConf.prototype);

function init(extensionMeta) {
	global.log('Init Gmail notify version '+_version);
	extensionPath=extensionMeta.path;
	let userExtensionLocalePath = extensionPath + '/locale';
	imports.gettext.bindtextdomain('gmail_notify', userExtensionLocalePath);



	try {
		button=new GmailButton();
		config=new GmailConf();
		bText=config._btext;
		if (_DEBUG) global.log('init numbers'+config._numbers);
		button.showNumbers(config._numbers);
		button.setIcon(0);
	}
	catch (err) {
		global.log(err.message);
	}
	libCheck();


};

function libCheck() {
	try {
		if (typeof(Goa) != 'undefined' && typeof(Soup) != 'undefined' && typeof(Gio) != 'undefined' ){
			button.setContent();
			if (_DEBUG) global.log('init timeout'+config._timeout);
		}
		else {
			button._showError(_('Extension requires Goa,Soup,Gio typelibs - click for instructions how to install'))
			button.setIcon(1);
			Main.panel._menus.addMenu(button.menu);
			show();
		}
	}
	catch (err) {
		global.log("init error:"+err.message);
	}
};


function _checkVersion()
{
	try {
	//let sSes=new Soup.SessionAsync();
	let sMes=Soup.Message.new('GET','http://gn.makrodata.org/index.php/current');
	sSes.queue_message(sMes,Lang.bind(this , function(oSes,oMes) {
		try {
		if (_DEBUG) global.log(oMes.response_body.data);
		let xdoc=new XML(oMes.response_body.data.replace('<?xml version="1.0" encoding="utf-8" ?>',''));
		if (_DEBUG) global.log("Current Verison: "+xdoc.version[0].number);
		nVersion=xdoc.version[0].number;
		if (nVersion > _version)
		{
			//bText=' ! %s(<u>%s</u>)'
		}
		}
		catch (err) {
			global.log("Check version callback:" +err.message)
		}

		}))
	}
	catch (err) {
		global.log("Check version:" +err.message)
	}
};

function show() {
	try{

		switch (config._position) {
			case 0: Main.panel._rightBox.insert_child_at_index(button.actor, 0);
					break;
			case 1: Main.panel._centerBox.insert_child_at_index(button.actor, 1);
					break;
			case 2: Main.panel._leftBox.insert_child_at_index(button.actor, 1);
					break;

		}
		currentPos = config._position;
	}
    catch (err) {
		global.log(err.message);
	}

};

function enable() {
	try {
		let userExtensionLocalePath = extensionPath + '/locale';
		global.log(' Enabling Gmail notify version '+_version);
		if (config == null ) config = new GmailConf();
		show();
		_initData();
		nVersion='';
		if (config.get_int(GCONF_DIR+'/vcheck')==1) _checkVersion();
		onetime= GLib.timeout_add_seconds(0,5, oneTime);
		event = GLib.timeout_add_seconds(0,config._timeout, onTimer);
		if (_DEBUG) global.log('Event created ',+event);
		}
		catch (err) {
			global.log("Enable "+err.message);
		}
};

function hide() {
	try{

	switch (config._position) {
		case 0: Main.panel._rightBox.remove_actor(button.actor);
			break;
		case 1: Main.panel._centerBox.remove_actor(button.actor);
		    break;
		case 2:	Main.panel._leftBox.remove_actor(button.actor);
			break;
		}
	}
	catch (err) {
		global.log(err.message);
	}
}

function disable() {
	hide();
	config._disconnectSignals();
	config = null;
	Mainloop.source_remove(onetime);
    Mainloop.source_remove(event);
    if (instantCheckLoopID instanceof Number)
        Mainloop.source_remove(instantCheckLoopID);
    goaAccounts=null;
}
