(function () {
	'use strict';

	const inum = (() => {
		let uid = 0;
		return () => {
			uid++;
			return uid;
		};
	})();

	const Dispatcher = class {
		#listeners = [];

		/**
		 * @param mask	{String}
		 * @return {*[]}
		 */
		get(mask) {
			let result = [];
			this.#listeners.forEach(({path, handler}) => {
				if (
					(typeof path === 'string' && mask === path) ||
					(path instanceof RegExp && path.test(mask))
				) {
					result.push({path: mask, value: handler});
				}
			});
			return result;
		}

		/**
		 * @param path		{String||RegExp}
		 * @param handler	{Function}
		 */
		set(path, handler) {
			//console.log('this.#listeners:', this.#listeners);
			this.#listeners.push({path: path, handler: handler});
		}
	};

	const splitSafe = function (str, splitter) {
		if (!splitter) {
			return [str];
		}
		//TODO: fix. Due to the fact that the script is loaded as a string and evals, slashes break
		let nodes = str.matchAll(new RegExp('(.*?[^\\\\])(?:\\' + splitter + '|$)', 'g'));
		let res = [];
		for (const match of nodes) {
			res.push(match[1]);
		}
		return res;
	};

	const isHash$1 = function (value) {
		return value instanceof Object && value.constructor === Object && '' + value !== '[object Arguments]';
	};

	/**
	 * @description Returns the value in the object found at the specified path
	 * @param obj				{Object}
	 * @param path				{String}
	 * @param cfg				{Object=}
	 * @param cfg.separator		{String=}	The separator is on the way. If the property is not specified but a dot is used
	 * @returns {undefined|{hasOwnProperty}|*}
	 */
	const getPropertyByPath = function (obj, path, cfg) {
		if (path === '') {
			return obj;
		} else if (typeof path === 'string') {
			let pathSteps, pathStep, i, l;
			let separator = (cfg && cfg.separator) ? cfg.separator : '.';
			pathSteps = path.split(separator);
			for (i = 0, l = pathSteps.length; pathStep = pathSteps[i], i < l && pathStep && obj; i++) {
				if (obj.hasOwnProperty && obj.hasOwnProperty(pathStep)) {
					obj = obj[pathStep];
				} else {
					break;
				}
			}
			return i < l ? undefined : obj;
		} else {
			throw new Error('getPropertyByPath argument should be string');
		}
	};


	/**
	 * @description set property by path in object
	 * @param obj					{Object}
	 * @param path					{String}
	 * @param value					{Object}
	 * @param options				{Object=}
	 * @param options.separator		{String=}	The separator is on the way. If the property is not specified but a dot is used
	 * @param options.isProperty	{Boolean=}
	 * @param options.force			{Boolean=}	[default:true]	If the property already exists, then the new value will overwrite the existing one.
	 * 											If you want the new value to be ignored, set this flag to false
	 * @returns {*}
	 */
	const setPropertyByPath = function (obj, path, value, options) {
		//console.log('[setPropertyByPath]:', path, value, options);
		let originValue = value;
		let nodes;
		if (!options) {
			options = {};
		}

		if (path && typeof path === 'number') {				//isNumber
			path += '';										//fast fix for indexes in arrays //OPTIMIZE
		}
		if (path && typeof path === 'string') {
			//console.log('init obj: ', data.obj);
			if (options.isProperty) {
				nodes = [path];
			} else {
				let separator = options.separator || '.';
				nodes = splitSafe(path, separator);
			}
		} else if (Array.isArray(path)) {
			nodes = path;
		}
		if (nodes) {
			//console.log('[setPropertyByPath] obj:', obj, 'nodes:', nodes);
			let propertyName;
			let tmpValue = {};
			let tmpRef = tmpValue;
			let lastPropertyName = nodes.pop();

			nodes.forEach(function (nodeName) {
				if (!Object.prototype.hasOwnProperty.call(obj, nodeName)) {
					//console.log('+create node:', nodeName);
					if (!propertyName) {
						propertyName = nodeName;
					} else {
						tmpRef[nodeName] = {};
						tmpRef = tmpRef[nodeName];
					}
				} else {
					if (!isHash$1(obj[nodeName]) && !Array.isArray(obj[nodeName])) {
						//console.log('+convert node to hash:', obj, nodeName, 'isHash:', Object.isHash(obj[nodeName]), 'isArr:', Array.isArray(obj[nodeName]));
						obj[nodeName] = {};
					}
					obj = obj[nodeName];
				}
			});

			if (!propertyName) {
				propertyName = lastPropertyName;
				tmpValue = value;
			} else {
				tmpRef[lastPropertyName] = value;
			}

			if (options.force === false && obj.hasOwnProperty(propertyName)) {		//If the property already exists and cannot be overwritten
				return obj[propertyName];
			}

			value = tmpValue;
			obj[propertyName] = value;

		} else {
			throw new Error('Path should be string: ' + path + '[' + Number.is(path) + ']');
		}
		return originValue;
	};

	const ObjectLive = (() => {
		let ProxyHandler = class ProxyHandler {
			constructor(owner, name) {
				this.owner = owner;
				this.name = name;
			}

			set(obj, p, newValue) {
				//console.log(`%c[ObjectLive] set[${this.name}]:`, 'background:green;', this, obj, p, newValue);
				let extra;
				if (newValue && newValue['_RP_MODEL_']) {
					extra = newValue.extra;
					newValue = newValue.value;
				}
				newValue = this.setRecursive(p, newValue);
				let oldValue = obj[p];
				let fullPath = (this.name + '.' + p).substr(11);
				this.owner.dispatchEvent('set', fullPath, {
					oldValue: oldValue,
					newValue: newValue,
					path: fullPath,
					extra: extra
				});
				obj[p] = newValue;
				//console.log('[ObjectLive] set new Value:', newValue, 'old:', oldValue);
				if (newValue !== oldValue) {
					this.owner.dispatchEvent('change', fullPath, {
						oldValue: oldValue,
						newValue: newValue,
						path: fullPath,
						extra: extra
					});
				}
				return true;
			}

			get(o, p) {
				//console.log('[ObjectLive] get:', o, p);
				return o[p];
			}

			deleteProperty(o, p) {
				//console.log('delete', p);
				return delete o[p];
			}

			setRecursive(p, v) {
				//console.log('[ObjectLive] set recursive');
				//check for falsy values
				if (v && v.constructor) {
					if (v.constructor === Object) {
						v = Object.keys(v).reduce((pp, cc) => {
							pp[cc] = this.setRecursive(p + '.' + cc, v[cc]);
							return pp;
						}, {});
						v = new Proxy(v, new ProxyHandler(this.owner, this.name + '.' + p));
					} else if (v.constructor === Array) {
						v = v.map((vv, vk) => this.setRecursive(p + '.' + vk, vv));
						['push', 'pop', 'shift', 'unshift'].forEach(m => {
							v[m] = data => {
								//console.log(m, data);
								return Array.prototype[m].call(v, data);
							};
						});
						v = new Proxy(v, new ProxyHandler(this.owner, this.name + '.' + p));
					}
				}
				return v;
			}
		};

		return class ObjectLive {
			#listeners = {};
			#value;

			constructor(obj) {
				//console.log('%c new ObjectLive:', 'background:blue', obj, this);
				this.#value = new Proxy({}, new ProxyHandler(this, 'start'));
				Object.assign(this.#value, {root: obj || {}});
			}

			get data() {
				return this.#value.root;
			}

			set data(obj) {
				this.#value.root = obj;
			}

			addEventListener(eventName, mask, handler) {
				//console.warn('addEventListener:', mask, eventName);
				if (!this.#listeners[eventName]) {
					this.#listeners[eventName] = new Dispatcher();
				}
				this.#listeners[eventName].set(mask, handler);
			}

			dispatchEvent(eventName, path, v) {
				//console.log('dispatchEvent:', eventName, 'path:', path, this.#listeners[eventName]);
				if (this.#listeners[eventName]) {
					let listeners = this.#listeners[eventName].get(path);
					Object.values(listeners).forEach(cfg => {
						cfg.value(v, path);
					});
				}
			}

			bridgeChanges(path, remoteObj, remotePath) {
				let changeId = inum();
				//console.log('%c[ObjectLive] Bridged:', 'background:magenta;', this, 'path:', path, 'remoteObj:', remoteObj, 'remotePath:', remotePath);

				//if changed our object we will change remote
				this.addEventListener('change', new RegExp('^' + path + '(' + (path ? '\\.' :'' ) + '.*)?'), cfg => {
					if (cfg.extra && cfg.extra.initiator === changeId) {
						return;
					}

					const relativePath = cfg.path.replace(new RegExp('^' + path + '(\\.|$)'), '');
					const newPath = remotePath + (remotePath ? '.' : '') + relativePath;
					//console.log('[ObjectLive] our change, set remote:', cfg, 'path:', path, 'newPath:', newPath, 'remotePath:', remotePath, 'relativePath:', relativePath, 'initiator:', changeId);
					setPropertyByPath(remoteObj.data, newPath, {
						_RP_MODEL_: true,
						value: cfg.newValue,
						extra: {initiator: changeId}
					});
				});

				//if changed remote object we will change our
				remoteObj.addEventListener('change', new RegExp('^' + remotePath + '(' + (path ? '\\.' :'' ) + '.*)?'), cfg => {
					if (cfg.extra && cfg.extra.initiator === changeId) {
						return;
					}
					const relativePath = cfg.path.replace(new RegExp('^' + remotePath + '(\\.|$)'), '');
					const newPath = path + (path ? '.' : '') + relativePath;
					//console.log('[ObjectLive] remote change, set our:', cfg, 'path:', path, 'newPath:', newPath, 'remotePath:', remotePath, 'relativePath:', relativePath, 'initiator:', changeId);
					setPropertyByPath(this.data, newPath, {
						_RP_MODEL_: true,
						value: cfg.newValue,
						extra: {initiator: changeId}
					});
				});
			}
		};
	})();

	const RP = class extends HTMLElement {
		model;
		logic;
		#modelChangeHandlers = {};

		constructor(tree, modelData, logic) {
			super();
			this.model = modelData instanceof ObjectLive ? modelData : new ObjectLive(modelData);
			this.logic = logic || {};

			//console.log('RPNode:', this);
			//console.log('tree:', tree);
			//console.log('logic:', logic);

			this.#treeRender(this, tree.vDom.tree);

			Object.entries(this.#modelChangeHandlers).forEach(([path, handlers]) => {
				//console.warn('subscribe:', path);
				let renderPath = (cfg) => {
					//console.log();
					//console.log('model change:', path);
					handlers.forEach(handler => handler(cfg));
				};
				this.model.addEventListener("change", path, renderPath);

				if (path.indexOf('.') !== -1) {	//Если в пути есть точка, то может родитель измениться. Подписываемся на изменение родителя
					let rootPath = path.split('.')[0];		//TODO: нужно рекурсивно всех перебирать
					this.model.addEventListener("change", rootPath, renderPath);
				}
			});
		}

		logicSet(logic) {
			this.logic = logic;
		}

		#modelChangeHandlersAdd(path, handler) {
			if (!this.#modelChangeHandlers[path]) {
				this.#modelChangeHandlers[path] = [];
			}
			this.#modelChangeHandlers[path].push(handler);
		}

		#treeRender(root, tree) {
			const nodeConstructors = {
				textNode: (params) => {
					let value = params.value !== undefined && params.value !== null ? params.value : '';
					const node = document.createTextNode(value);
					if (params.modelDepends) {
						params.modelDepends.forEach(dep => {
							if (dep.refName === 'm') {
								const render = () => {
									try {
										node.textContent = (new Function('self, model',
											'const m = model;' +
											'return ' + params.valueOutRender + ';'
										))(this.logic, this.model.data);
									} catch (e) {}
								};
								this.#modelChangeHandlersAdd(dep.modelPath, render);
								render();
							}
						});
					}
					return node;
				},

				splitNode: () => {
					return document.createComment('-');
				},

				tag: (params) => {
					const node = document.createElement(params.tagName);
					//console.warn('node:', node);
					//console.warn('params:', params);
					if (params.attrs) {
						Object.entries(params.attrs).forEach(([attrName, attrCfg]) => {
							if (attrCfg.type === "event") {
								node[attrName] = event => {
									return (new Function('self, model, event',
										'const m = model, e=event;' +
										attrCfg.fn + ';'
									))(this.logic, this.model.data, event);
								};
							} else {
								let attrNode = document.createAttribute(attrName);
								if (attrCfg.modelDepends) {
									//console.log('dynamic attr:', attrNode, attrName, attrCfg, params);

									attrCfg.modelDepends.forEach(dep => {
										if (dep.refName === 'm') {
											let render;

											if (params.tagName === 'input' && attrName === 'value') {
												const initiator = 'input.' + inum();
												render = (cfg) => {
													if (!(cfg && cfg.extra && cfg.extra.initiator && cfg.extra.initiator === initiator)) {
														const value = (new Function('self, model',
															'const m = model;' +
															'return ' + attrCfg.valueOutRender + ';'
														))(this.logic, this.model.data);
														//console.warn('[rp render] changeCfg:', cfg, initiator, node, this, 'attrCfg:', attrCfg, attrName, 'value', value);
														if (node.type === 'checkbox') {
															node.checked = value;
														} else {
															node.value = value;
														}
													}
												};
												node.addEventListener('input', (e) => {
													let value;
													if (node.type === "checkbox") {
														value = node.checked;
													} else {
														value = node.value;
													}
													//console.log('input event:', e, value, attrCfg, this);
													setPropertyByPath(this.model.data, attrCfg.modelOut[0].modelPath, {
														_RP_MODEL_: true,
														value: value,
														extra: {initiator: initiator}
													});
												});
											} else {
												render = () => {
													try {
														attrNode.value = (new Function('self, model',
															'const m = model, e=event;' +
															'return ' + attrCfg.valueOutRender + ';'
														))(this.logic, this.model.data);
													} catch (e) {}
												};
											}
											this.#modelChangeHandlersAdd(dep.modelPath, render);
											render();

										}
									});
								} else {
									attrNode.value = attrCfg.value;
								}
								node.setAttributeNode(attrNode);
							}
							//this.attrs[attrCfg.apid] = attrNode;
						});
					}

					if (params.childNodes) {
						this.#treeRender(node, params.childNodes);
					}
					return node;
				},

				component: (params) => {
					let node;
					//console.log('create component:', params);
					let tagClass = customElements.get(params.tagName);
					if (tagClass) {
						let model = new ObjectLive({});
						//console.log('[rp] model:', model);

						Object.entries(params.attrs).forEach(([attrName, attrCfg]) => {
							//console.log('[rp] bind attr:', attrName, attrCfg);
							if (attrCfg.type === 'string') ; else if (attrCfg.type === 'json') {
								if (attrCfg.modelDepends) {
									attrCfg.modelDepends.forEach(dep => {
										//console.log('[rp] model:', this.model, 'attrName:',attrName, 'dep:', dep, 'attrCfg:', attrCfg);

										let curValue = getPropertyByPath(this.model.data, dep.modelPath);
										model.data[attrName] = curValue;
										//console.log('curValue:', curValue);
										//console.log('new:', model.data[attrName]);

										//Если наша модель изменилось - меняем в компоненте
										if (dep.refName === 'm') {
											if (!this.#modelChangeHandlers[dep.modelPath]) {
												this.#modelChangeHandlers[dep.modelPath] = [];
											}
											this.#modelChangeHandlers[dep.modelPath].push((value) => {
												//TODO: use inRender
											});
										}
									});

									//Бриджим свою модель с моделью компонента
									attrCfg.modelDepends.forEach(dep => {
										if (dep.refName === 'm') {
											if (!dep.jsonInnerPath) {
												//console.log('%ccomponent model bridge:', 'background:magenta;', dep.modelPath, model, attrName);
												this.model.bridgeChanges(dep.modelPath, model, attrName);
											}
										}
									});
								}
							}
						});
						node = new tagClass(model);

						if (params.childNodes) {
							this.#treeRender(node, params.childNodes);
						}

						//console.warn('component:', node);
					} else {
						console.warn("Component used, but not exist: " + params.tagName, '; Render as tag');
						node = nodeConstructors.tag(params);
					}
					return node;
				}
			};

			tree.forEach(params => {
				if (nodeConstructors[params.type]) {
					const node = nodeConstructors[params.type](params);
					root.appendChild(node);
				} else {
					throw new Error('Wrong node type:' + params.type);
				}

			});
		}
	};

	customElements.define('x-rp', RP);

	let Tpl_wrapper = class extends RP {
						constructor(model, logic) {
							const tree = {"vDom":{"tree":[{"type":"component","tagName":"x-menu","attrs":{"config":{"valueOutRender":"m.menu","modelDepends":[{"refName":"m","modelPath":"menu","valueOutRender":"m.menu","jsonInnerPath":""}],"modelOut":[{"refName":"m","modelPath":"menu"}],"type":"json"}},"childNodes":[]},{"type":"component","tagName":"x-panelspace","attrs":{},"childNodes":[]}]}};
							super(tree, model, logic);
						}
					};
					customElements.define('x-tpl_wrapper', Tpl_wrapper);

	const rules$E = [{"selector":"x-tpl_wrapper ","rule":"display: flex;flex-direction: column;justify-content: center;height: 100%;"},{"selector":"x-tpl_wrapper > x-menu ","rule":"border-bottom: var(--space-border);"}];
				let cssStyle$E;
				const css$G = {
					install:() => {
						cssStyle$E = document.createElement("style");
						document.head.appendChild(cssStyle$E);
						const cssStyleSheet = cssStyle$E.sheet;
						rules$E.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/app/app.css]:', rules);
					},
					remove:() => {
						if (cssStyle$E) {document.head.removeChild(cssStyle$E);}
					}
				};

	const rules$D = [{"selector":"x-tpl_settings ","rule":"display: grid;height: 100%;width: 100%;grid-template-rows: auto 50px;grid-template-columns: 200px auto;grid-template-areas: 'settingsSidebar settingsEditor' 'settingsControl settingsControl';"},{"selector":"x-tpl_settings > x-tree ","rule":"grid-area: settingsSidebar;padding-top: 20px;box-sizing: border-box;width: 200px;height: 100%;overflow: auto;display: inline-block;background: var(--sidebar-bg-color);"},{"selector":"x-tpl_settings [name=content] ","rule":"grid-area: settingsEditor;display: inline-block;overflow: auto;padding: 20px;flex: 1 1 0;"},{"selector":"x-tpl_settings h2 ","rule":"margin: 0;"},{"selector":"x-tpl_settings h3 ","rule":"display: flex;align-items: center;margin-top: 30px;font-size: 12px;"},{"selector":"x-tpl_settings h3::after ","rule":"content: '';flex: 1;margin-left: 10px;height: 1px;background-color: var(--body-hr-color);"},{"selector":"x-tpl_settings h3+div ","rule":"padding-left: 30px;"},{"selector":"x-tpl_settings .control ","rule":"grid-area: settingsControl;border-top: 1px solid var(--body-hr-color);"},{"selector":"x-tpl_settings .control button ","rule":"float: right;padding: 5px 30px;margin: 10px 20px;"}];
				let cssStyle$D;
				const css$F = {
					install:() => {
						cssStyle$D = document.createElement("style");
						document.head.appendChild(cssStyle$D);
						const cssStyleSheet = cssStyle$D.sheet;
						rules$D.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/modal/settings/settings.css]:', rules);
					},
					remove:() => {
						if (cssStyle$D) {document.head.removeChild(cssStyle$D);}
					}
				};

	/**
	 * @method		cumulativeHeight
	 * @return		{Number}
	 */
	const cumulativeHeight = (elm) => {
		let cs = window.getComputedStyle(elm, null);
		//TODO: +border + padding!
		return elm.offsetHeight + parseInt(cs.getPropertyValue('margin-top')) + parseInt(cs.getPropertyValue('margin-bottom'));
	};


	/**
	 * @method		cumulativeWidth
	 * @return		{Number}
	 */
	const cumulativeWidth = (elm) => {
		let cs = window.getComputedStyle(elm, null);
		return parseInt(cs.marginLeft) +
			parseInt(cs.borderLeftWidth) +
			elm.offsetWidth +
			parseInt(cs.borderRightWidth) +
			parseInt(cs.marginRight);
	};


	/**
	 * @name isCrossOver
	 */
	const isIntersecting = (el, area) => {
		let elViewPort = el.getBoundingClientRect();
		let areaViewPort = area.getBoundingClientRect();
		let r1 = {
			left: elViewPort.left,
			right: elViewPort.left + elViewPort.width,
			top: elViewPort.top,
			bottom: elViewPort.top + elViewPort.height
		};
		let r2 = {
			left: areaViewPort.left,
			right: areaViewPort.left + areaViewPort.width,
			top: areaViewPort.top,
			bottom: areaViewPort.top + areaViewPort.height
		};
		return !(r2.left > r1.right ||
			r2.right < r1.left ||
			r2.top > r1.bottom ||
			r2.bottom < r1.top);
	};


	const animate = function (node, className, callback) {
		node.classList.add(className);
		let animationEvent = () => {
			node.removeEventListener('animationend', animationEvent);
			node.classList.remove(className);
			if (callback) {
				callback();
			}
		};
		node.addEventListener('animationend', animationEvent);
	};


	const animateProperty = ($el, prop, endValue, callback) => {
		let elStyles = window.getComputedStyle($el, null);
		let startValue = Number.parseInt(elStyles[prop]);
		//console.log('[animate] node:', $el._.uid, prop, 'from:', startValue, 'to:', endValue);
		if (startValue === endValue) {
			if (callback) {
				callback($el);
			}
		} else {
			$el.style['transition'] = 'all 0.15s linear';
			$el.style[prop] = endValue + 'px';
			let onTransitionEnd;
			onTransitionEnd = (e) => {
				if (e.propertyName === prop) {
					$el.removeEventListener('transitionend', onTransitionEnd);
					$el.style['transition'] = '';
					if (callback) {
						callback($el);
					}
				}
			};
			$el.addEventListener('transitionend', onTransitionEnd, true);
		}
	};


	/**
	 * @method		insertAfter
	 * @description Inserts the specified node after a reference element as a child of the current node.
	 * @returns
	 */
	const insertAfter = (parent, newElement, referenceElement) => {
		let nextNode = referenceElement.nextSibling;
		if (nextNode) {
			parent.insertBefore(newElement, nextNode);
		} else {
			parent.appendChild(newElement);
		}
	};


	const childNodesRemove = function (parent) {
		let children = parent.childNodes;
		while (children.length) {
			if (children[0] && children[0].parentNode) {
				children[0].parentNode.removeChild(children[0]);
			} else {
				break;
			}
		}
	};


	/**
	 * @name isChildOf
	 * @description if node is child of rootNode
	 * @params checkedNode	{Node}
	 * @params rootNode		{Node}
	 * @return 				{Boolean}
	 */
	const isChildOf = (p, rootNode) => {
		let b = document.body;
		while (p && p !== rootNode && p !== b) {
			p = p.parentNode;
		}
		return (p && p !== b);
	};

	const rules$C = [{"selector":"x-window ","rule":"position: absolute;display: block;border: 1px solid #515151;user-select: none;-ms-user-select: none;-moz-user-select: none;-webkit-user-select: none;border-radius: 4px;box-shadow: 0 0 1em rgba(0, 0, 0, 0.5);opacity: 1;box-sizing: border-box;font-family: Arial, sans-serif;"},{"selector":"x-window.opening ","rule":"animation: window-opening 0.15s ease-in-out 1;"},{"selector":"@keyframes window-opening ","rule":"0%{transform: scale(0.7); opacity: 0}100%{transform: scale(1); opacity: 1}"},{"selector":"x-window.minify ","rule":"animation: window-minify 0.3s linear 1;"},{"selector":"@keyframes window-minify ","rule":"0%{transform: scaleX(1) scaleY(1);}100%{transform: scaleX(var(--window-minify-scale-w)) scaleY(var(--window-minify-scale-h));left: var(--window-minify-to-x);top: var(--window-minify-to-y);}"},{"selector":"x-window.restore ","rule":"animation: window-restore 0.3s linear 1;"},{"selector":"@keyframes window-restore ","rule":"0%{transform: scaleX(var(--window-minify-scale-w)) scaleY(var(--window-minify-scale-h));left: var(--window-minify-to-x);top: var(--window-minify-to-y);}100%{transform: scaleX(1) scaleY(1);}"},{"selector":"x-window.max ","rule":"animation: window-max-pos 0.2s linear 1;"},{"selector":"x-window.max > x-tpl_window > div[name='wrapper'] ","rule":"animation: window-max-size 0.2s linear 1;width: var(--window-minify-to-w);height: var(--window-minify-to-h);"},{"selector":"@keyframes window-max-pos ","rule":"0%{}100%{left: var(--window-minify-to-x);top: var(--window-minify-to-y);}"},{"selector":"@keyframes window-max-size ","rule":"0%{width: var(--window-minify-from-w);height: var(--window-minify-from-h);}100%{width: var(--window-minify-to-w);height: var(--window-minify-to-h);}"},{"selector":"x-window.closing ","rule":"animation: window-closing 0.15s ease-in-out 1;"},{"selector":"@keyframes window-closing ","rule":"0%{transform: scale(1); opacity: 1}100%{transform: scale(0.7); opacity: 0}"},{"selector":"x-window div[name='wrapper'] ","rule":"display: block;"},{"selector":"x-window.created ","rule":"opacity: 1;transition: opacity 0.6s;"},{"selector":"x-window.removed ","rule":"opacity: 0;transition: all 0.2s;"},{"selector":"x-window.active ","rule":"border: 1px solid #888;"},{"selector":"x-window.active.highlight ","rule":"animation: coreWindowHighlight 0.3s infinite;animation-iteration-count: 2;-moz-animation: coreWindowHighlight 0.3s infinite;-moz-animation-iteration-count: 2;-webkit-animation: coreWindowHighlight 0.3s infinite;-webkit-animation-iteration-count: 2;"},{"selector":".window_caption ","rule":"display: table-row;height: 26px;line-height: 26px;font-size: 12px;color: var(--head-text-color);cursor: default;background: var(--head-bg-color);"},{"selector":".window_caption div[name='titlebar'] ","rule":"display: block;position: relative;border-bottom: 1px solid var(--head-hr-color);"},{"selector":".window_caption div[name='title'] ","rule":"text-align: left;padding-left: 15px;width: 100%;display: inline-block;padding-right: 96px;box-sizing: border-box;"},{"selector":".window_caption .window_controlButtons ","rule":"position: absolute;right: 0;top: 0;line-height: 26px;border-top-right-radius: 3px;overflow: hidden;"},{"selector":".window_control ","rule":"width: 30px;display: inline-block;vertical-align: top;text-align: center;"},{"selector":".window_control_max ","rule":"font-size: 12px;"},{"selector":".window_control:hover ","rule":"background: var(--element-bg-color-hover);"},{"selector":".window_control_close:hover ","rule":"background: #ff0067;color: white;"},{"selector":".window_content ","rule":"background: var(--body-bg-color);color: var(--body-text-color);display: table-row;position: relative;width: 100%;height: 100%;"},{"selector":".crop ","rule":"position: absolute;width: 100%;height: 100%;"},{"selector":".crop .crop-line ","rule":"position: absolute;"},{"selector":".crop .crop-top-line ","rule":"top: 0;left: 0;right: 0;height: 5px; margin-top: -3px;cursor: n-resize;"},{"selector":".crop .crop-bottom-line ","rule":"bottom: 0;left: 0;right: 0;height: 5px; margin-bottom: -3px;cursor: s-resize;"},{"selector":".crop .crop-left-line ","rule":"top: 0;left: 0;bottom: 0;width: 5px; margin-left: -3px;cursor: w-resize;"},{"selector":".crop .crop-right-line ","rule":"top: 0;right: 0;bottom: 0;width: 5px; margin-right: -3px;cursor: e-resize;"},{"selector":".crop .crop-corner ","rule":"position: absolute;width: 6px;height: 6px;"},{"selector":".crop .crop-top-left-corner ","rule":"top: -3px;left: -3px;cursor: nw-resize;"},{"selector":".crop .crop-top-right-corner ","rule":"top: -3px;right: -3px;cursor: ne-resize;"},{"selector":".crop .crop-bottom-left-corner ","rule":"bottom: -3px;left: -3px;cursor: sw-resize;"},{"selector":".crop .crop-bottom-right-corner ","rule":"bottom: -3px;right: -3px;cursor: se-resize;"}];
				let cssStyle$C;
				const css$E = {
					install:() => {
						cssStyle$C = document.createElement("style");
						document.head.appendChild(cssStyle$C);
						const cssStyleSheet = cssStyle$C.sheet;
						rules$C.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/ui/window/window.css]:', rules);
					},
					remove:() => {
						if (cssStyle$C) {document.head.removeChild(cssStyle$C);}
					}
				};

	const rules$B = [{"selector":"x-uilock ","rule":"position: absolute;top: 0;left: 0;width: 100%;height: 100%;background: black;opacity: 0.7;animation: uilock-open 0.4s ease-in-out 1;"},{"selector":"x-uilock.closing ","rule":"animation: uilock-close 0.3s ease-in-out 1;"},{"selector":"@keyframes uilock-open ","rule":"0% {opacity: 0.3}100% {opacity: 0.7}"},{"selector":"@keyframes uilock-close ","rule":"0% {opacity: 0.7}100% {opacity: 0}"}];
				let cssStyle$B;
				const css$D = {
					install:() => {
						cssStyle$B = document.createElement("style");
						document.head.appendChild(cssStyle$B);
						const cssStyleSheet = cssStyle$B.sheet;
						rules$B.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/ui/uiLock/uiLock.css]:', rules);
					},
					remove:() => {
						if (cssStyle$B) {document.head.removeChild(cssStyle$B);}
					}
				};

	css$D.install();

	class UiLock extends HTMLElement {
		constructor(zIndex) {
			super();
			this.style.zIndex = zIndex;
			document.body.appendChild(this);
		}

		unlock() {
			this.addEventListener('animationend', () => {
				document.body.removeChild(this);
			});
			this.className = 'closing';
		}
	}

	customElements.define('x-uilock', UiLock);

	const mouse = {};

	const drag = {
		target: null,
		enabled: false,
		startX: null,
		startY: null,
		prevPageX: null,
		prevPageY: null
	};

	document.body.addEventListener('mousedown', e => {
		//dragstart event
		if (e.target) {
			drag.enabled = true;
			drag.target = e.target;
			drag.startX = e['pageX'];
			drag.startY = e['pageY'];
			drag.target.ondragstart = () => {
				return false;
			};
			/*drag.target.onselectstart = () => {
				return false;
			};*/
			drag.prevPageX = e['pageX'];
			drag.prevPageY = e['pageY'];
			drag.target.dispatchEvent(new CustomEvent('mousedragstart', {
				detail: {
					pageX: e['pageX'],
					pageY: e['pageY'],
					startX: e['layerX'],
					startY: e['layerY'],
					prevPageX: drag.prevPageX,
					prevPageY: drag.prevPageY,
				}
			}));
		}
	});

	window.addEventListener('mouseup', e => {
		if (drag.target) {
			drag.enabled = false;
			drag.target.dispatchEvent(new CustomEvent('mousedragstop', {
				detail: {
					pageX: e['pageX'],
					pageY: e['pageY'],
					offsetX: e['pageX'] - drag.startX,
					offsetY: e['pageY'] - drag.startY
				}
			}));
		}
	});

	document.body.addEventListener('mousemove', e => {
		mouse.pageX = e['pageX'];
		mouse.pageY = e['pageY'];
		if (drag.enabled) {
			drag.target.dispatchEvent(new CustomEvent('mousedrag', {
				detail: {
					d: e,
					pageX: e['pageX'],
					pageY: e['pageY'],
					offsetX: e['pageX'] - drag.startX,
					offsetY: e['pageY'] - drag.startY,
					stepOffsetX: e['pageX'] - drag.prevPageX,
					stepOffsetY: e['pageY'] - drag.prevPageY
				}
			}));
			drag.prevPageX = e['pageX'];
			drag.prevPageY = e['pageY'];
		}
	});

	let Tpl_window = class extends RP {
						constructor(model, logic) {
							const tree = {"vDom":{"tree":[{"type":"tag","tagName":"div","attrs":{"name":{"value":"wrapper","type":"string"}},"childNodes":[{"type":"tag","tagName":"div","attrs":{"class":{"value":"crop","type":"string"}},"childNodes":[{"type":"tag","tagName":"div","attrs":{"name":{"value":"borders","type":"string"}},"childNodes":[{"type":"tag","tagName":"div","attrs":{"class":{"value":"crop-line crop-top-line","type":"string"},"direction":{"value":"Top","type":"string"}},"childNodes":[]},{"type":"tag","tagName":"div","attrs":{"class":{"value":"crop-line crop-right-line","type":"string"},"direction":{"value":"Right","type":"string"}},"childNodes":[]},{"type":"tag","tagName":"div","attrs":{"class":{"value":"crop-line crop-bottom-line","type":"string"},"direction":{"value":"Bottom","type":"string"}},"childNodes":[]},{"type":"tag","tagName":"div","attrs":{"class":{"value":"crop-line crop-left-line","type":"string"},"direction":{"value":"Left","type":"string"}},"childNodes":[]},{"type":"tag","tagName":"div","attrs":{"class":{"value":"crop-corner crop-top-left-corner","type":"string"},"direction":{"value":"TopLeft","type":"string"}},"childNodes":[]},{"type":"tag","tagName":"div","attrs":{"class":{"value":"crop-corner crop-top-right-corner","type":"string"},"direction":{"value":"TopRight","type":"string"}},"childNodes":[]},{"type":"tag","tagName":"div","attrs":{"class":{"value":"crop-corner crop-bottom-right-corner","type":"string"},"direction":{"value":"BottomRight","type":"string"}},"childNodes":[]},{"type":"tag","tagName":"div","attrs":{"class":{"value":"crop-corner crop-bottom-left-corner","type":"string"},"direction":{"value":"BottomLeft","type":"string"}},"childNodes":[]}]},{"type":"tag","tagName":"div","attrs":{"style":{"value":"display: table; width: 100%; height: 100%;","type":"string"}},"childNodes":[{"type":"tag","tagName":"div","attrs":{"class":{"value":"window_caption","type":"string"}},"childNodes":[{"type":"tag","tagName":"div","attrs":{"name":{"value":"titlebar","type":"string"},"ondblclick":{"type":"event","fn":"self.max();"}},"childNodes":[{"type":"tag","tagName":"div","attrs":{"name":{"value":"title","type":"string"}},"childNodes":[{"type":"splitNode"},{"type":"textNode","value":"","placeNum":9,"valueInRender":null,"valueOutRender":"m.title","modelDepends":[{"refName":"m","modelPath":"title","canSync":true}]},{"type":"splitNode"}]},{"type":"tag","tagName":"div","attrs":{"class":{"value":"window_controlButtons","type":"string"}},"childNodes":[{"type":"tag","tagName":"span","attrs":{"class":{"value":"window_control window_control_max","type":"string"},"action":{"value":"max","type":"string"},"onclick":{"type":"event","fn":"self.max();"}},"childNodes":[{"type":"textNode","value":"◱"}]},{"type":"tag","tagName":"span","attrs":{"class":{"value":"window_control window_control_close","type":"string"},"action":{"value":"close","type":"string"},"onclick":{"type":"event","fn":"self.close();"}},"childNodes":[{"type":"textNode","value":"✕"}]}]}]}]},{"type":"tag","tagName":"div","attrs":{"name":{"value":"content","type":"string"},"class":{"value":"window_content","type":"string"}},"childNodes":[]}]}]}]}]}};
							super(tree, model, logic);
						}
					};
					customElements.define('x-tpl_window', Tpl_window);

	css$E.install();


	let Window = (() => {
		let winZindex = 100;

		return class extends HTMLElement {
			#cfg;
			#state;
			#drag;
			#$window;
			#$windowWrapper;
			#$titleBar;
			#$uiLock;
			#$borderWrapper;

			/**
			 * @param cfg			{Object}
			 * @param cfg.title		{String}
			 * @param cfg.width		{Number}
			 * @param cfg.height	{Number}
			 * @param cfg.uiLock	{Boolean=}
			 * @param cfg.onClose	{Boolean=}
			 * @param cfg.$content	{Boolean=}
			 */
			constructor(cfg) {
				super();
				//console.log('[window] cfg:', cfg);
				this.#cfg = cfg;
				this.#cfg.height += 20;	//TODO: сейчас шапка включается в высоту, поэтому увеличиваем. Нужно сделать по нормальному

				/*
				app.addEventListener('app-close', () => {
					this.close();
				}, true);

				app.addEventListener('app-focus', () => {
					this.#up();
				}, true);

				app.addEventListener('app-background', (e) => {
					this.#background(app.$task.getBoundingClientRect());
				}, true);

				app.addEventListener('app-foreground', (e) => {
					this.#foreground(app.$task.getBoundingClientRect());
				}, true);
				*/

				let ww = document.body.clientWidth;
				let wh = document.body.clientHeight;

				this.#state = {
					x: ww > this.#cfg.width ? (document.body.clientWidth - this.#cfg.width) / 2 : 0,
					y: wh > this.#cfg.height ? (wh - this.#cfg.height) / 3 : 0,
					width: this.#cfg.width,
					height: this.#cfg.height,
					isMax: false,
					stashed: {}
				};
				this.#drag = {
					enabled: false,
					direction: null,
					x: null,
					y: null,
					width: this.#cfg.width,
					height: this.#cfg.height
				};
				this.style.left = this.#state.x + 'px';
				this.style.top = this.#state.y + 'px';
				winZindex++;
				if (this.#cfg.uiLock) {
					this.#$uiLock = new UiLock(winZindex);
					winZindex++;
				}
				this.style.zIndex = winZindex.toString();

				this.#$window = new Tpl_window(this.#cfg, this);
				this.appendChild(this.#$window);

				this.#$windowWrapper = this.#$window.querySelector('div[name="wrapper"]');
				this.#$windowWrapper.addEventListener('mousedown', () => {
					this.#up();
				});
				this.#$windowWrapper.style.width = this.#state.width + 'px';
				this.#$windowWrapper.style.height = this.#state.height + 'px';

				this.#$titleBar = this.#$window.querySelector('div[name="titlebar"]');
				this.#$titleBar.addEventListener('mousedragstart', (e) => {
					if (!e.target.hasAttribute('action')) {
						this.#drag.enabled = true;
						let viewport = this.getBoundingClientRect();
						this.#drag.x = viewport.left;
						this.#drag.y = viewport.top;
					}
				}, true);
				this.#$titleBar.addEventListener('mousedrag', (e) => {
					if (this.#drag.enabled) {
						let left = this.#drag.x + e.detail.offsetX;
						let top = this.#drag.y + e.detail.offsetY;
						this.style.left = left + 'px';
						this.style.top = top + 'px';
						this.#state.x = left;
						this.#state.y = top;
					}
				}, true);
				this.#$titleBar.addEventListener('mousedragstop', () => {
					this.#drag.enabled = false;
				}, true);

				this.#$borderWrapper = this.#$window.querySelector('div[name="borders"]');
				this.#$borderWrapper.childNodes.forEach((node) => {
					node.addEventListener('mousedragstart', e => {
						this.#drag.direction = e.target.getAttribute('direction');
						let viewport = this.getBoundingClientRect();
						this.#drag.width = viewport.width;
						this.#drag.height = viewport.height;
						this.#state.x = viewport.left;
						this.#state.y = viewport.top;
					});
					node.addEventListener('mousedrag', (e) => {
						this.#resize(e.detail);
					});
				});

				/*
				let $minButton = this.#$window.querySelector('span[action="min"]');
				if (this.#cfg.canMin === false) {
					$minButton._.hide();
				}

				let $maxButton = this.#$window.querySelector('span[action="max"]');
				if (this.#cfg.canMax === false) {
					$maxButton._.hide();
				}*/

				this.$windowContent = this.#$window.querySelector('div[name="content"]');
				//console.log('this.$windowContent:', this.$windowContent);
				this.$windowContent.appendChild(this.#cfg.$content);
				animate(this, 'opening');

				document.body.appendChild(this);
			}

			max() {
				console.log('max');
				if (this.#state.isMax) {
					this.#state.isMax = false;
					this.style.setProperty('--window-minify-to-x', this.#state.stashed.x + 'px');
					this.style.setProperty('--window-minify-to-y', this.#state.stashed.y + 'px');
					this.style.setProperty('--window-minify-from-w', this.#state.width + 'px');
					this.style.setProperty('--window-minify-from-h', this.#state.height + 'px');
					this.style.setProperty('--window-minify-to-w', this.#state.stashed.width + 'px');
					this.style.setProperty('--window-minify-to-h', this.#state.stashed.height + 'px');
					animate(this, 'max', () => {
						this.#state.width = this.#state.stashed.width;
						this.#state.height = this.#state.stashed.height;
						this.style.left = this.#state.stashed.x + 'px';
						this.style.top = this.#state.stashed.y + 'px';
						this.#$windowWrapper.style.width = this.#state.width + 'px';
						this.#$windowWrapper.style.height = this.#state.height + 'px';
					});
				} else {
					this.#state.isMax = true;
					let toX = 0;
					let toY = 0;
					let toW = document.body.clientWidth - toX;
					let toH = document.body.clientHeight - toY;
					this.#state.stashed.x = this.#state.x;
					this.#state.stashed.y = this.#state.y;
					this.#state.stashed.width = this.#state.width;
					this.#state.stashed.height = this.#state.height;
					this.style.setProperty('--window-minify-to-x', toX + 'px');
					this.style.setProperty('--window-minify-to-y', toY + 'px');
					this.style.setProperty('--window-minify-from-w', this.#state.width + 'px');
					this.style.setProperty('--window-minify-from-h', this.#state.height + 'px');
					this.style.setProperty('--window-minify-to-w', toW + 'px');
					this.style.setProperty('--window-minify-to-h', toH + 'px');
					animate(this, 'max', () => {
						this.#state.width = toW;
						this.#state.height = toH;
						this.style.left = toX + 'px';
						this.style.top = toY + 'px';
						this.#$windowWrapper.style.width = toW + 'px';
						this.#$windowWrapper.style.height = toH + 'px';
					});
				}
			}

			actionClose() {
				this.close();
			}

			#up() {
				winZindex++;
				this.style.zIndex = winZindex.toString();
			}

			/*
			#background(taskPosition) {
				let toX = taskPosition.x - (this.clientWidth - taskPosition.width) / 2;
				let toY = taskPosition.y - (this.clientHeight - taskPosition.height) / 2;
				let scaleW = taskPosition.width / this.clientWidth;
				let scaleH = taskPosition.height / this.clientHeight;
				this.style.setProperty('--window-minify-to-x', toX + 'px');
				this.style.setProperty('--window-minify-to-y', toY + 'px');
				this.style.setProperty('--window-minify-scale-w', '' + scaleW);
				this.style.setProperty('--window-minify-scale-h', '' + scaleH);
				this._.animate('minify', () => {
					this.style.display = 'none';
				});
			}

			#foreground(taskPosition) {
				this.#up();
				this.style.display = 'block';
				let toX = taskPosition.x - (this.clientWidth - taskPosition.width) / 2;
				let toY = taskPosition.y - (this.clientHeight - taskPosition.height) / 2;
				let scaleW = taskPosition.width / this.clientWidth;
				let scaleH = taskPosition.height / this.clientHeight;
				this.style.setProperty('--window-minify-to-x', toX + 'px');
				this.style.setProperty('--window-minify-to-y', toY + 'px');
				this.style.setProperty('--window-minify-scale-w', '' + scaleW);
				this.style.setProperty('--window-minify-scale-h', '' + scaleH);
				this._.animate('restore');
			}
			*/

			/*
			titleSet(title) {
				this.#$windowCaption.innerHTML = title;
			}
			 */

			#resize(detail) {
				if (this.#drag.direction.indexOf('Right') !== -1) {
					this.#state.width = (this.#drag.width + detail.offsetX);
					this.#$windowWrapper.style.width = this.#state.width + 'px';
				} else if (this.#drag.direction.indexOf('Left') !== -1) {
					this.style.left = (this.#state.x + detail.offsetX) + 'px';
					this.#state.width = (this.#drag.width - detail.offsetX);
					this.#$windowWrapper.style.width = this.#state.width + 'px';
				}
				if (this.#drag.direction.indexOf('Bottom') !== -1) {
					this.#state.height = (this.#drag.height + detail.offsetY);
					this.#$windowWrapper.style.height = this.#state.height + 'px';
				} else if (this.#drag.direction.indexOf('Top') !== -1) {
					this.style.top = (this.#state.y + detail.offsetY) + 'px';
					this.#state.height = (this.#drag.height - detail.offsetY);
					this.#$windowWrapper.style.height = this.#state.height + 'px';
				}
				this.dispatchEvent(new Event('resize'));
			}

			close() {
				if (this.#cfg.uiLock) {
					this.#$uiLock.unlock();
				}
				animate(this, 'closing', () => {
					this.parentNode.removeChild(this);
				});
				if (this.#cfg.onClose) {
					this.#cfg.onClose();
				}
			}
		};

	})();

	customElements.define('x-window', Window);

	let Tpl_settings = class extends RP {
						constructor(model, logic) {
							const tree = {"vDom":{"tree":[{"type":"component","tagName":"x-tree","attrs":{"value":{"valueOutRender":"m.settingsTree","modelDepends":[{"refName":"m","modelPath":"settingsTree","valueOutRender":"m.settingsTree","jsonInnerPath":""}],"modelOut":[{"refName":"m","modelPath":"settingsTree"}],"type":"json"},"selected":{"valueOutRender":"m.selectedCategory","modelDepends":[{"refName":"m","modelPath":"selectedCategory","valueOutRender":"m.selectedCategory","jsonInnerPath":""}],"modelOut":[{"refName":"m","modelPath":"selectedCategory"}],"type":"json"}},"childNodes":[]},{"type":"tag","tagName":"div","attrs":{"name":{"value":"content","type":"string"}},"childNodes":[]},{"type":"tag","tagName":"div","attrs":{"class":{"value":"control","type":"string"}},"childNodes":[{"type":"tag","tagName":"button","attrs":{"onclick":{"type":"event","fn":"self.close();"},"class":{"value":"main big","type":"string"}},"childNodes":[{"type":"textNode","value":"Ok"}]}]}]}};
							super(tree, model, logic);
						}
					};
					customElements.define('x-tpl_settings', Tpl_settings);

	const isObject = function (value) {
		return value instanceof Object;
	};

	const isHash = function (value) {
		return value instanceof Object && value.constructor === Object && '' + value !== '[object Arguments]';
	};


	/** @method forEachRecursive
	 *	@description	Recursively iterates through all the keys of an object, calling a function with parameters (value, key, num). Can traverse hash keys, Node.childNodes, Node.attributes, DocumentFragment
	 *	@param iterator				{Function}	Iterator function(value, path, {object, propertyPath})
	 *	@param cfg					{Object}
	 *	@param cfg.objectCallback	{Object=}	[:true] If set, call a callback for all nodes (if false, then only for leaves)
	 *	@param cfg.ignoreNonHash	{boolean=}	[:true] If set to false, then it will recursively access all object attributes (Date, String, Node, etc.)
	 *	@param cfg.pathPrefix		{String=}	A prefix that will be assigned to all paths when calling the callback
	 *	@param cfg.property			{String=}	Will only go into the specified property (for example childNodes to recursively iterate through all children)
	 *	@return						{Array}		The paths along which we ran
	 */
	const forEachRecursive = (function () {
		let paths;
		let recursive = function (obj, path, iterator, cfg) {
			let pathPrefix, curPath, i, keys, l, key, value;
			path += path && '.';
			pathPrefix = (cfg.pathPrefix ? cfg.pathPrefix : '');
			cfg.pathPrefix = '';

			if (cfg.property) {
				obj = obj[cfg.property];
				if (!obj) {
					return;
				} else {
					path += cfg.property + '.';
				}
			}

			for (i = 0, keys = Object.keys(obj), l = keys.length; i < l; i++) {
				key = keys[i];
				value = obj[key];

				curPath = pathPrefix + path + key;

				if (isHash(value) || Array.isArray(value) || (!cfg.ignoreNonHash && Object.keys(value) > 0)) {
					if (cfg.objectCallback) {		// Вызываем итератор если нужно для ноды
						iterator(value, curPath, {object: obj, propertyName: key});
						paths.push(curPath);
					}
					recursive(value, curPath, iterator, cfg);
				} else {							// Вызываем итератор если это лист
					iterator(value, curPath, {object: obj, propertyName: key});
					paths.push(curPath);
				}
			}
		};

		return function (obj, iterator, cfg) {
			paths = [];
			if (!cfg) {
				cfg = {};
			}
			if (cfg.objectCallback === undefined) {
				cfg.objectCallback = true;
			}
			if (cfg.ignoreNonHash === undefined) {
				cfg.ignoreNonHash = true;
			}

			if (isObject(obj) || Array.isArray(obj) || cfg.ignoreNonHash === false) {
				recursive(obj, '', iterator, cfg);
			} else {
				console.warn('invalid type', obj, cfg);
			}
			return paths;
		};
	})();

	const settings$1 = new (class {
		#settingsEditor = {};			// {path: HTMLElementConstructor}
		settingsTree = [];
		model;

		constructor() {
			const localSettingsRaw = localStorage.getItem('settings');
			const settingsData = localSettingsRaw ? JSON.parse(localSettingsRaw) : {};
			this.model = new ObjectLive(settingsData);

			const changeHandler = _ => {
				//console.warn('settings changed', _.path, this.model);
				localStorage.setItem('settings', JSON.stringify(this.model.data));
			};
			this.model.addEventListener('change', /.*/, changeHandler);
		}

		editorGet(path) {
			/*
			let $editor = this.#$editors[path];
			if (!$editor) {
				$editor = this.#$editors[path] = new this.#settingsEditor[path]();
			}
			return $editor;
			*/
			//console.log('editor get:', path);
			return new this.#settingsEditor[path]();
		}

		settingsByPathGet(path) {
			return path.split('.').reduce((acc, nodeName) => {
				let node = acc[nodeName];
				if (!node) {
					acc[nodeName] = {};
					node = acc[nodeName];
				}
				return node;
			}, this.model.data);
		}

		/**
		 * @param cfg				{Object}
		 * @param cfg.name			{String}
		 * @param cfg.path			{String}
		 * @param cfg.struct		{Object}
		 * @param cfg.isDirectory	{Boolean}
		 * @param cfg.$settings		{HTMLElement}
		 */
		define(cfg) {
			this.#settingsEditor[cfg.path] = cfg.$settings;

			//set settings tree
			cfg.path.split('.').reduce((acc, nodeName) => {
				let node = acc.find(item => item === nodeName);
				if (node) {
					return node.childNodes;
				} else {
					acc.push({
						title: cfg.name,
						value: cfg.path.replace(/\./g, '_'),
						color: '#fff',
						isDirectory: cfg.isDirectory,
						isVisible: true,
						isExpanded: false
					});
				}
			}, this.settingsTree);

			//upgrade default struct
			const rootModel = this.settingsByPathGet(cfg.path);
			forEachRecursive(cfg.struct, (value, path) => {
				path.split('.').reduce((acc, nodeName) => {
					let node = acc[nodeName];
					if (node === undefined) {
						node = acc[nodeName] = value;
					}
					return node;
				}, rootModel);
			});

			//console.log('[Settings] define:', cfg);
			//console.log(JSON.parse(localStorage.settings));
		}
	})();

	css$F.install();

	/*
	const subSettings = {
		appearance: Tpl_settings_appearance,
		keymap: Tpl_settings_keymap,
		editor: Tpl_settings_editor,
		editor_colorScheme: Tpl_settings_editor_colorScheme,
		editor_codeStyle: Tpl_settings_editor_codeStyle,
		editor_codeStyle_javascript: Tpl_settings_editor_codeStyle_javascript,
		plugins: Tpl_settings_plugins,
		build: Tpl_settings_build,
		build_compiler: Tpl_settings_build_compiler,
		build_compiler_javascript: Tpl_settings_build_compiler_javascript
	}

	[
					{
						title: 'Appearance',
						value: 'appearance',
						color: '#fff',
						isDirectory: false,
						isVisible: true,
						isExpanded: false
					},
					{
						title: 'Keymap',
						value: 'keymap',
						color: '#fff',
						isDirectory: false,
						isVisible: true,
						isExpanded: false
					},
					{
						title: 'Editor',
						value: 'editor',
						color: '#fff',
						isDirectory: true,
						isVisible: true,
						isExpanded: false,
						childNodes: [
							{
								title: 'Color scheme',
								value: 'editor_colorScheme',
								color: '#fff',
								isDirectory: false,
								isVisible: true,
								isExpanded: false
							},
							{
								title: 'Code style',
								value: 'editor_codeStyle',
								color: '#fff',
								isDirectory: true,
								isVisible: true,
								isExpanded: false,
								childNodes: [
									{
										ico: 'file_js',
										title: 'Javascript',
										value: 'editor_codeStyle_javascript',
										color: '#fff',
										isDirectory: false,
										isVisible: true
									}
								]
							},
						]
					},

					{
						title: 'Plugins',
						value: 'plugins',
						color: '#fff',
						isDirectory: false,
						isVisible: true,
						isExpanded: false
					},
					{
						title: 'Build, Execution',
						value: 'build',
						color: '#fff',
						isDirectory: true,
						isVisible: true,
						isExpanded: false,
						childNodes: [
							{
								title: 'Compiler',
								value: 'build_compiler',
								color: '#fff',
								isDirectory: true,
								isVisible: true,
								childNodes: [
									{
										ico: 'file_js',
										title: 'Javascript',
										value: 'build_compiler_javascript',
										color: '#fff',
										isDirectory: false,
										isVisible: true
									}
								]
							}
						]
					}
				]

	*/



	const settings = () => new (class {
		#$window;
		#$settings;
		#$settingsContainer;

		constructor() {
			this.#$settings = new Tpl_settings({
				selectedCategory: null,
				settingsTree: settings$1.settingsTree
			}, this);

			this.#$settingsContainer = this.#$settings.querySelector('[name=content]');

			this.#$settings.model.addEventListener('change', 'selectedCategory', (e) => {
				childNodesRemove(this.#$settingsContainer);
				//console.log('selectedCategory cahnge:', e);
				const $page = settings$1.editorGet(e.newValue);
				this.#$settingsContainer.appendChild($page);
			});

			this.#$settings.model.data.selectedCategory = 'appearance';		//set default category

			this.#$window = new Window({
				title: 'Settings',
				width: 800,
				height: 500,
				uiLock: true,
				$content: this.#$settings
			});
		};

		close() {
			this.#$window.close();
		}
	})();

	const rules$A = [{"selector":"x-tpl_setting_appearance x-dropdown ","rule":"margin-left: 5px;color: #3a3a3a;"}];
				let cssStyle$A;
				const css$C = {
					install:() => {
						cssStyle$A = document.createElement("style");
						document.head.appendChild(cssStyle$A);
						const cssStyleSheet = cssStyle$A.sheet;
						rules$A.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/app/appearance/appearance.css]:', rules);
					},
					remove:() => {
						if (cssStyle$A) {document.head.removeChild(cssStyle$A);}
					}
				};

	let Tpl_setting_appearance = class extends RP {
						constructor(model, logic) {
							const tree = {"vDom":{"tree":[{"type":"tag","tagName":"h2","attrs":{},"childNodes":[{"type":"textNode","value":"Appearance"}]},{"type":"tag","tagName":"h3","attrs":{},"childNodes":[{"type":"textNode","value":"General"}]},{"type":"tag","tagName":"div","attrs":{},"childNodes":[{"type":"tag","tagName":"div","attrs":{"style":{"value":"display: none;","type":"string"}},"childNodes":[{"type":"tag","tagName":"input","attrs":{"type":{"value":"checkbox","type":"string"},"value":{"valueOutRender":"m.general.syncThemeWithOs","modelDepends":[{"refName":"m","modelPath":"general.syncThemeWithOs","valueOutRender":"m.general.syncThemeWithOs","jsonInnerPath":""}],"modelOut":[{"refName":"m","modelPath":"general.syncThemeWithOs"}],"type":"json"}},"childNodes":[]},{"type":"textNode","value":" Sync with OS"}]},{"type":"tag","tagName":"div","attrs":{},"childNodes":[{"type":"textNode","value":"Theme:"},{"type":"component","tagName":"x-dropdown","attrs":{"value":{"valueOutRender":"m.general.theme","modelDepends":[{"refName":"m","modelPath":"general.theme","valueOutRender":"m.general.theme","jsonInnerPath":""}],"modelOut":[{"refName":"m","modelPath":"general.theme"}],"type":"json"}},"childNodes":[{"type":"tag","tagName":"item","attrs":{"value":{"value":"darcula","type":"string"}},"childNodes":[{"type":"textNode","value":"Darcula"}]},{"type":"tag","tagName":"item","attrs":{"value":{"value":"light","type":"string"}},"childNodes":[{"type":"textNode","value":"Light"}]}]}]}]},{"type":"tag","tagName":"h3","attrs":{},"childNodes":[{"type":"textNode","value":"UI options"}]},{"type":"tag","tagName":"div","attrs":{},"childNodes":[{"type":"tag","tagName":"div","attrs":{},"childNodes":[{"type":"tag","tagName":"input","attrs":{"type":{"value":"checkbox","type":"string"},"value":{"valueOutRender":"m.uiOptions.showGutter","modelDepends":[{"refName":"m","modelPath":"uiOptions.showGutter","valueOutRender":"m.uiOptions.showGutter","jsonInnerPath":""}],"modelOut":[{"refName":"m","modelPath":"uiOptions.showGutter"}],"type":"json"}},"childNodes":[]},{"type":"textNode","value":" "},{"type":"tag","tagName":"label","attrs":{"onclick":{"type":"event","fn":"m.uiOptions.showGutter = !m.uiOptions.showGutter"}},"childNodes":[{"type":"textNode","value":"Show gutter"}]}]},{"type":"tag","tagName":"div","attrs":{},"childNodes":[{"type":"tag","tagName":"input","attrs":{"type":{"value":"checkbox","type":"string"},"value":{"valueOutRender":"m.uiOptions.showLineNumbers","modelDepends":[{"refName":"m","modelPath":"uiOptions.showLineNumbers","valueOutRender":"m.uiOptions.showLineNumbers","jsonInnerPath":""}],"modelOut":[{"refName":"m","modelPath":"uiOptions.showLineNumbers"}],"type":"json"}},"childNodes":[]},{"type":"textNode","value":" "},{"type":"tag","tagName":"label","attrs":{"onclick":{"type":"event","fn":"m.uiOptions.showLineNumbers = !m.uiOptions.showLineNumbers"}},"childNodes":[{"type":"textNode","value":"Show line numbers"}]}]},{"type":"tag","tagName":"div","attrs":{},"childNodes":[{"type":"tag","tagName":"input","attrs":{"type":{"value":"checkbox","type":"string"},"value":{"valueOutRender":"m.uiOptions.showIndent","modelDepends":[{"refName":"m","modelPath":"uiOptions.showIndent","valueOutRender":"m.uiOptions.showIndent","jsonInnerPath":""}],"modelOut":[{"refName":"m","modelPath":"uiOptions.showIndent"}],"type":"json"}},"childNodes":[]},{"type":"textNode","value":" "},{"type":"tag","tagName":"label","attrs":{"onclick":{"type":"event","fn":"m.uiOptions.showIndent = !m.uiOptions.showIndent"}},"childNodes":[{"type":"textNode","value":"Show tree indent guides"}]}]},{"type":"tag","tagName":"div","attrs":{},"childNodes":[{"type":"tag","tagName":"input","attrs":{"type":{"value":"checkbox","type":"string"},"value":{"valueOutRender":"m.uiOptions.showStatusBar","modelDepends":[{"refName":"m","modelPath":"uiOptions.showStatusBar","valueOutRender":"m.uiOptions.showStatusBar","jsonInnerPath":""}],"modelOut":[{"refName":"m","modelPath":"uiOptions.showStatusBar"}],"type":"json"}},"childNodes":[]},{"type":"textNode","value":" "},{"type":"tag","tagName":"label","attrs":{"onclick":{"type":"event","fn":"m.uiOptions.showStatusBar = !m.uiOptions.showStatusBar"}},"childNodes":[{"type":"textNode","value":"Show status bar"}]}]}]},{"type":"tag","tagName":"h3","attrs":{},"childNodes":[{"type":"textNode","value":"Tool windows"}]},{"type":"tag","tagName":"div","attrs":{},"childNodes":[{"type":"tag","tagName":"div","attrs":{},"childNodes":[{"type":"tag","tagName":"input","attrs":{"type":{"value":"checkbox","type":"string"},"value":{"valueOutRender":"m.toolWindows.showToolBar","modelDepends":[{"refName":"m","modelPath":"toolWindows.showToolBar","valueOutRender":"m.toolWindows.showToolBar","jsonInnerPath":""}],"modelOut":[{"refName":"m","modelPath":"toolWindows.showToolBar"}],"type":"json"}},"childNodes":[]},{"type":"textNode","value":" "},{"type":"tag","tagName":"label","attrs":{"onclick":{"type":"event","fn":"m.toolWindows.showToolBar = !m.toolWindows.showToolBar"}},"childNodes":[{"type":"textNode","value":"Show tool window bars"}]}]}]}]}};
							super(tree, model, logic);
						}
					};
					customElements.define('x-tpl_setting_appearance', Tpl_setting_appearance);

	const Pool = class Pool {
		length = 0;
		#handlers = {};		// {uid1: {fn, data}, uid2: {inc: pool}}

		/**
		 * @method include
		 * @description Include one pool into another pool
		 * @param pool			Another instance of pool class
		 * @return {Object}
		 */
		include(pool) {
			let uid;
			if (!pool || !(pool instanceof Pool)) {
				throw new Error('Only other transaction objects can be included in a transaction');
			}
			uid = inum();
			this.#handlers[uid] = {inc: pool};
		}

		/**
		 * @method push
		 * @description Pushes onto the stack a function that will run when the transaction starts.
		 * @param fn			{Function|Array|Number}	Function or array of functions
		 * @param data			{Object=}				The data to be sent to handlers when the pool will be started
		 * @return {Number|undefined}					You can remove this handler from the pool by this id
		 */
		push(fn, data) {
			if (Array.isArray(fn)) {
				fn.forEach(value => {
					this.push(value, data);
				});
			} else {
				const uid = inum();
				this.#handlers[uid] = {fn: fn, data: data};
				this.length++;
				return uid;
			}
		}

		/**
		 * @method clear
		 * @description Clears the call stack
		 */
		clear() {
			this.#handlers = {};
			this.length = 0;
		}

		/**
		 * @method remove
		 * @description Removes a function from the pool by its uid, which was issued when pushing
		 * @param uid		{Number}
		 */
		remove(uid) {
			if (this.#handlers[uid]) {
				delete this.#handlers[uid];
				this.length--;
			}
		}

		/**
		 * @method run
		 * @description Runs all pool methods
		 * @param data	{Object=}		Data passed to each handler
		 */
		run(data) {
			Object.values(this.#handlers).forEach(cfg => {
				const req = cfg.data !== undefined ? [cfg.data, ...data] : data;
				if (cfg.fn) {
					cfg.fn(req);
				} else {
					cfg.inc.run(req);
				}
			});
		}
	};

	/**
	 * @singleton
	 * @description command bus
	 * @example
	 * 		new Command('open', (fileName) => { ... });
	 * 		Command.exec('open', "testfile");
	 * 		Command.on('open', (fileName) => { ... });
	 */

	const commands = {};
	const Command = class {
		mainHandler;
		eventHandlers;

		constructor(name, mainHandler) {
			this.mainHandler = mainHandler;
			commands[name] = this;
			this.eventHandlers = new Pool();
		}

		static on(name, handler) {
			const cmd = commands[name];
			if (cmd) {
				cmd.eventHandlers.push(handler);
			} else {
				throw new Error('Wrong command: '+ name);
			}
		}

		static exec(name, data) {
			const cmd = commands[name];
			if (cmd) {
				const res = cmd.mainHandler(data);
				if (res !== undefined) {
					cmd.eventHandlers.run(res);
				} else {
					cmd.eventHandlers.run(data);
				}
			}
		}
	};

	const rules$z = [{"selector":"button ","rule":"background: var(--active-element-bg-color);color: var(--element-text-color);border: var(--element-border);border-radius: var(--element-border-radius);font-size: 12px;outline: none;padding: 1px 4px;box-sizing: border-box;"},{"selector":"button.big ","rule":"padding: 5px 15px;"},{"selector":"button.main ","rule":"background: var(--element-selected-bg-color);color: var(--element-selected-text-color);border: 1px solid #268ce4;"},{"selector":"button.main:hover ","rule":"background: var(--element-selected-bg-color-hover);"},{"selector":"button[disabled] ","rule":"background: var(--element-bg-color);border: var(--element-border);box-sizing: border-box;opacity: 0.5;"}];
				let cssStyle$z;
				const css$B = {
					install:() => {
						cssStyle$z = document.createElement("style");
						document.head.appendChild(cssStyle$z);
						const cssStyleSheet = cssStyle$z.sheet;
						rules$z.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/app/appearance/themes/common/css/button.css]:', rules);
					},
					remove:() => {
						if (cssStyle$z) {document.head.removeChild(cssStyle$z);}
					}
				};

	const rules$y = [{"selector":"html, body ","rule":"width: 100%;height: 100%;padding:0;margin: 0;background: var(--body-bg-color);color: var(--body-text-color);Font-Family: Arial, Serif, serif;overflow: hidden;"},{"selector":"body ","rule":"font-size: var(--body-font-size);"},{"selector":"body.cursorResizeRow ","rule":"cursor: row-resize;"},{"selector":"body.cursorResizeCol ","rule":"cursor: col-resize;"}];
				let cssStyle$y;
				const css$A = {
					install:() => {
						cssStyle$y = document.createElement("style");
						document.head.appendChild(cssStyle$y);
						const cssStyleSheet = cssStyle$y.sheet;
						rules$y.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/app/appearance/themes/common/css/html.css]:', rules);
					},
					remove:() => {
						if (cssStyle$y) {document.head.removeChild(cssStyle$y);}
					}
				};

	const rules$x = [{"selector":"input, textarea, .input ","rule":"background: var(--input-bg-color);color: var(--element-text-color);border: var(--input-border);border-radius: var(--element-border-radius);font-size: 12px;outline: none;padding: 4px 10px;box-sizing: border-box;"},{"selector":"input, .input ","rule":"height: 24px;vertical-align: middle;"},{"selector":"input+label, .input+label ","rule":"vertical-align: middle;"},{"selector":"input:disabled, textarea:disabled ","rule":"opacity: 0.5;"}];
				let cssStyle$x;
				const css$z = {
					install:() => {
						cssStyle$x = document.createElement("style");
						document.head.appendChild(cssStyle$x);
						const cssStyleSheet = cssStyle$x.sheet;
						rules$x.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/app/appearance/themes/common/css/input.css]:', rules);
					},
					remove:() => {
						if (cssStyle$x) {document.head.removeChild(cssStyle$x);}
					}
				};

	const rules$w = [{"selector":"table ","rule":"color: var(--text-color);"}];
				let cssStyle$w;
				const css$y = {
					install:() => {
						cssStyle$w = document.createElement("style");
						document.head.appendChild(cssStyle$w);
						const cssStyleSheet = cssStyle$w.sheet;
						rules$w.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/app/appearance/themes/common/css/table.css]:', rules);
					},
					remove:() => {
						if (cssStyle$w) {document.head.removeChild(cssStyle$w);}
					}
				};

	const rules$v = [{"selector":".link ","rule":"color: var(--active-text-color);cursor: pointer;"},{"selector":".link:hover ","rule":"color: var(--active-text-color-hover);"},{"selector":".link.dashed ","rule":"text-underline-mode: dashed;"},{"selector":".link.dashed ","rule":"text-underline-mode: underline;"},{"selector":".action ","rule":"color: var(--text-color);cursor: default;"},{"selector":".action:hover ","rule":"color: var(--element-text-color);"},{"selector":".actionHover ","rule":"cursor: default;"}];
				let cssStyle$v;
				const css$x = {
					install:() => {
						cssStyle$v = document.createElement("style");
						document.head.appendChild(cssStyle$v);
						const cssStyleSheet = cssStyle$v.sheet;
						rules$v.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/app/appearance/themes/common/css/link.css]:', rules);
					},
					remove:() => {
						if (cssStyle$v) {document.head.removeChild(cssStyle$v);}
					}
				};

	const rules$u = [{"selector":"html ","rule":"scrollbar-face-color: #000;scrollbar-base-color: #646464;scrollbar-3dlight-color: #646464;scrollbar-highlight-color: #646464;scrollbar-track-color: #646464;scrollbar-arrow-color: #646464;scrollbar-shadow-color: #646464;scrollbar-dark-shadow-color: #646464;"},{"selector":"::-webkit-scrollbar ","rule":"width: 8px;height: 8px;"},{"selector":"::-webkit-scrollbar-button ","rule":"background-color: #666;height: 0;width: 0;"},{"selector":"::-webkit-scrollbar-track ","rule":"background-color: transparent;"},{"selector":"::-webkit-scrollbar-track-piece ","rule":"background-color: transparent;"},{"selector":"::-webkit-scrollbar-thumb ","rule":"height: 0;width: 0;background-color: var(--body-hr-color);border: 0;"},{"selector":"::-webkit-scrollbar-corner ","rule":"background-color: transparent;"},{"selector":"::-webkit-resizer ","rule":"background-color: #666;"}];
				let cssStyle$u;
				const css$w = {
					install:() => {
						cssStyle$u = document.createElement("style");
						document.head.appendChild(cssStyle$u);
						const cssStyleSheet = cssStyle$u.sheet;
						rules$u.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/app/appearance/themes/common/css/scrollbar.css]:', rules);
					},
					remove:() => {
						if (cssStyle$u) {document.head.removeChild(cssStyle$u);}
					}
				};

	const rules$t = [{"selector":"select ","rule":"background: var(--element-bg-color);border: var(--element-border);border-radius: var(--element-border-radius);outline: none;color: var(--element-text-color);"},{"selector":"select option ","rule":""}];
				let cssStyle$t;
				const css$v = {
					install:() => {
						cssStyle$t = document.createElement("style");
						document.head.appendChild(cssStyle$t);
						const cssStyleSheet = cssStyle$t.sheet;
						rules$t.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/app/appearance/themes/common/css/select.css]:', rules);
					},
					remove:() => {
						if (cssStyle$t) {document.head.removeChild(cssStyle$t);}
					}
				};

	const rules$s = [{"selector":".error ","rule":"color: red;"}];
				let cssStyle$s;
				const css$u = {
					install:() => {
						cssStyle$s = document.createElement("style");
						document.head.appendChild(cssStyle$s);
						const cssStyleSheet = cssStyle$s.sheet;
						rules$s.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/app/appearance/themes/common/css/text.css]:', rules);
					},
					remove:() => {
						if (cssStyle$s) {document.head.removeChild(cssStyle$s);}
					}
				};

	const rules$r = [{"selector":".ico, .icoColor ","rule":"display: inline-block;background-size: cover;"},{"selector":".icoQuiet .ico, .ico.icoQuiet ","rule":"opacity: 0.6;"},{"selector":".ico.arrowUp ","rule":"width: 16px;height: 16px;background-image:url('data:image/svg+xml;utf8,<svg version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 96 96\"><path d=\"M52,83.999V21.655l21.172,21.172c1.562,1.562,4.094,1.562,5.656,0c1.562-1.562,1.562-4.095,0-5.657l-28-28c-1.562-1.562-4.095-1.562-5.656,0l-28,28C16.391,37.951,16,38.974,16,39.999c0,1.023,0.391,2.047,1.172,2.828c1.562,1.562,4.095,1.562,5.656,0L44,21.655v62.344c0,2.209,1.791,4,4,4S52,86.208,52,83.999z\"/></svg>');"},{"selector":".ico.arrowDown ","rule":"width: 16px;height: 16px;background-image:url('data:image/svg+xml;utf8,<svg version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 96 96\"><path d=\"M44,12v62.344L22.828,53.172c-1.562-1.562-4.094-1.562-5.656,0c-1.562,1.562-1.562,4.095,0,5.657l28,28c1.562,1.562,4.095,1.562,5.656,0l28-28C79.609,58.048,80,57.024,80,56c0-1.023-0.391-2.047-1.172-2.828c-1.562-1.562-4.095-1.562-5.656,0L52,74.344V12c0-2.208-1.791-4-4-4S44,9.791,44,12z\"/></svg>');"},{"selector":".ico.directRight ","rule":"width: 14px;height: 14px;background-image:url('data:image/svg+xml;utf8,<svg version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path d=\"M4 13h2l5-5-5-5h-2l5 5z\"></path></svg>');"},{"selector":".ico.directDown ","rule":"width: 14px;height: 14px;background-image:url('data:image/svg+xml;utf8,<svg version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path d=\"M13 4v2l-5 5-5-5v-2l5 5z\"></path></svg>');"},{"selector":".ico.project ","rule":"width: 16px;height: 16px;background-image:url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"64pt\" height=\"64pt\" viewBox=\"0 0 22.577778 22.577778\" version=\"1.1\">\t<g transform=\"translate(0,-274.42223)\">\t\t<path\t\t\td=\"m 11.537453,290.45599 -0.75644,-0.84847 c -0.8524317,-0.95602 -0.333915,-2.51235 0.921701,-2.76512 l 1.117194,-0.22572 c 0.482161,-0.0971 0.899465,-0.39534 1.147421,-0.82026 l 0.573712,-0.98282 c 0.32277,-0.55315 0.89317,-0.82618 1.462497,-0.82228 v 6.9e-4 c 0.569324,0.004 1.135558,0.28701 1.449729,0.8451 l 0.558933,0.99024 c 0.241311,0.42871 0.654067,0.7332 1.134661,0.83772 l 0.74166,0.16258 v -4.43317 c 0,-1.21987 -0.997053,-2.21692 -2.216919,-2.21692 H 9.5596928 c -0.3855877,0 -0.728662,-0.23174 -0.8733309,-0.58916 L 8.1556445,278.28108 C 7.9065911,277.66577 7.3085817,277.25996 6.64478,277.25996 H 3.4987718 c -1.392457,0 -2.52863397,1.13686 -2.52863397,2.5293 v 8.28725 H 8.6178386 c 0.1889156,7.2e-4 0.3418774,0.15369 0.3426135,0.34261 6.878e-4,0.18997 -0.1526523,0.34457 -0.3426135,0.34531 H 0.97013783 v 0.57438 c 0,1.38446 1.12872337,2.51729 2.51318337,2.51318 l 8.4776998,-0.0252 c 0.05972,-0.51389 -0.0962,-1.00364 -0.423568,-1.3708 z M 9.5415559,278.36437 c -0.1899578,6.9e-4 -0.3433427,0.15534 -0.3426169,0.34531 v 0.41449 l 0.08935,0.22035 c 0.047388,0.11713 0.1456045,0.18541 0.2714038,0.18541 h 8.1125802 c 1.573204,0 2.863856,1.29133 2.863856,2.86453 v 3.98105 h 0.291559 c 0.42592,4.1e-4 0.779951,-0.35336 0.779951,-0.77927 v -4.71533 c 0,-1.38447 -1.129389,-2.51587 -2.513851,-2.51587 z m 6.4572781,6.29202 c -0.332804,-0.003 -0.665925,0.16499 -0.863254,0.50318 l -0.573712,0.98485 c -0.346754,0.5942 -0.933214,1.01165 -1.607603,1.14742 l -1.117193,0.2237 c -0.767447,0.15449 -1.064593,1.04802 -0.543479,1.63246 l 0.759127,0.85049 c 0.457818,0.51347 0.673824,1.19831 0.594535,1.8817 l -0.132341,1.13264 c -0.09027,0.77794 0.667217,1.33823 1.383892,1.02315 l 1.043298,-0.45951 c 0.629722,-0.27697 1.347666,-0.27181 1.973058,0.0148 l 1.035906,0.47495 c 0.711684,0.32622 1.477487,-0.22102 1.399344,-1.0003 l -0.11219,-1.13265 c -0.06864,-0.68456 0.158982,-1.36732 0.62477,-1.87362 l 0.769204,-0.83773 c 0.530147,-0.57626 0.246994,-1.47407 -0.517953,-1.64051 l -1.111818,-0.24391 c -0.672191,-0.14625 -1.252005,-0.57342 -1.589466,-1.17295 l -0.558932,-0.99291 c -0.192074,-0.3412 -0.522391,-0.51267 -0.855193,-0.51527 z\"\t\t/>\t</g></svg>');"},{"selector":".icoColor.folder ","rule":"width: 16px;height: 16px;background-image:url('data:image/svg+xml;utf8,<svg version=\"1.1\" id=\"Capa_1\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 554.625 554.625\"><path d=\"M516.375,143.438h-229.5l-38.25-76.5H38.25C17.212,66.938,0,84.15,0,105.188v344.25c0,21.037,17.212,38.25,38.25,38.25 h478.125c21.037,0,38.25-17.213,38.25-38.25v-267.75C554.625,160.65,537.412,143.438,516.375,143.438z\"/></svg>');filter: brightness(0) invert(1) brightness(80%);"},{"selector":".icoColor.file_js ","rule":"width: 16px;height: 16px;background-image:url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><rect x=\"2\" y=\"2\" width=\"28\" height=\"28\" style=\"fill:orange\"/><path d=\"M20.809,23.875a2.866,2.866,0,0,0,2.6,1.6c1.09,0,1.787-.545,1.787-1.3,0-.9-.716-1.222-1.916-1.747l-.658-.282c-1.9-.809-3.16-1.822-3.16-3.964,0-1.973,1.5-3.476,3.853-3.476a3.889,3.889,0,0,1,3.742,2.107L25,18.128A1.789,1.789,0,0,0,23.311,17a1.145,1.145,0,0,0-1.259,1.128c0,.789.489,1.109,1.618,1.6l.658.282c2.236.959,3.5,1.936,3.5,4.133,0,2.369-1.861,3.667-4.36,3.667a5.055,5.055,0,0,1-4.795-2.691Zm-9.295.228c.413.733.789,1.353,1.693,1.353.864,0,1.41-.338,1.41-1.653V14.856h2.631v8.982c0,2.724-1.6,3.964-3.929,3.964a4.085,4.085,0,0,1-3.947-2.4Z\"/></svg>');"},{"selector":".ico.eye ","rule":"width: 16px;height: 16px;background-image:url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path d=\"M21.87,11.5c-.64-1.11-4.16-6.68-10.14-6.5C6.2,5.14,3,10,2.13,11.5a1,1,0,0,0,0,1c.63,1.09,4,6.5,9.89,6.5h.25c5.53-.14,8.74-5,9.6-6.5A1,1,0,0,0,21.87,11.5ZM12.22,17c-4.31.1-7.12-3.59-8-5,1-1.61,3.61-4.9,7.61-5,4.29-.11,7.11,3.59,8,5C18.8,13.61,16.22,16.9,12.22,17Z\"/><path d=\"M12,8.5A3.5,3.5,0,1,0,15.5,12,3.5,3.5,0,0,0,12,8.5Zm0,5A1.5,1.5,0,1,1,13.5,12,1.5,1.5,0,0,1,12,13.5Z\"/></svg>');"},{"selector":".ico.eyeoff ","rule":"width: 16px;height: 16px;background-image:url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path d=\"M4.71,3.29A1,1,0,0,0,3.29,4.71l5.63,5.63a3.5,3.5,0,0,0,4.74,4.74l5.63,5.63a1,1,0,0,0,1.42,0,1,1,0,0,0,0-1.42ZM12,13.5A1.5,1.5,0,0,1,10.5,12s0-.05,0-.07l1.56,1.56Z\"/><path d=\"M12.22,17c-4.3.1-7.12-3.59-8-5A13.7,13.7,0,0,1,6.46,9.28L5,7.87A15.89,15.89,0,0,0,2.13,11.5a1,1,0,0,0,0,1c.63,1.09,4,6.5,9.89,6.5h.25a9.48,9.48,0,0,0,3.23-.67l-1.58-1.58A7.74,7.74,0,0,1,12.22,17Z\"/><path d=\"M21.87,11.5C21.23,10.39,17.7,4.82,11.73,5a9.48,9.48,0,0,0-3.23.67l1.58,1.58A7.74,7.74,0,0,1,11.78,7c4.29-.11,7.11,3.59,8,5a13.7,13.7,0,0,1-2.29,2.72L19,16.13a15.89,15.89,0,0,0,2.91-3.63A1,1,0,0,0,21.87,11.5Z\"/></svg>');"},{"selector":".ico.settings ","rule":"width: 16px;height: 16px;background-image:url('data:image/svg+xml;utf8,<svg version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"-12 -12 200 200\"><path d=\"M173.145,73.91c-0.413-2.722-2.29-4.993-4.881-5.912l-13.727-4.881c-0.812-2.3-1.733-4.536-2.754-6.699l6.247-13.146c1.179-2.479,0.899-5.411-0.729-7.628c-5.265-7.161-11.556-13.452-18.698-18.693c-2.219-1.629-5.141-1.906-7.625-0.724l-13.138,6.242c-2.163-1.021-4.402-1.94-6.704-2.752l-4.883-13.729c-0.919-2.586-3.184-4.458-5.9-4.876c-9.65-1.483-16.792-1.483-26.457,0c-2.713,0.418-4.981,2.29-5.9,4.876l-4.883,13.729c-2.302,0.812-4.541,1.731-6.702,2.752l-13.143-6.242c-2.479-1.181-5.406-0.904-7.623,0.724c-7.142,5.241-13.433,11.532-18.698,18.693c-1.629,2.217-1.908,5.148-0.729,7.628l6.247,13.146c-1.021,2.159-1.94,4.4-2.754,6.699L5.982,68.003c-2.589,0.919-4.463,3.189-4.879,5.907c-0.749,4.92-1.099,9.115-1.099,13.219c0,4.098,0.35,8.299,1.099,13.219c0.413,2.722,2.29,4.993,4.881,5.912l13.727,4.881c0.814,2.304,1.736,4.541,2.754,6.704l-6.247,13.141c-1.179,2.479-0.899,5.411,0.727,7.623c5.258,7.156,11.549,13.447,18.7,18.698c2.217,1.629,5.144,1.911,7.625,0.724l13.138-6.242c2.163,1.021,4.402,1.94,6.704,2.752l4.883,13.729c0.919,2.586,3.184,4.458,5.9,4.876c4.828,0.744,9.154,1.104,13.228,1.104c4.074,0,8.401-0.36,13.228-1.104c2.715-0.418,4.981-2.29,5.9-4.876l4.883-13.729c2.302-0.812,4.541-1.731,6.704-2.752l13.138,6.242c2.484,1.186,5.411,0.904,7.628-0.724c7.159-5.26,13.45-11.551,18.698-18.698c1.626-2.212,1.906-5.144,0.727-7.623l-6.247-13.141c1.021-2.163,1.942-4.405,2.754-6.704l13.727-4.881c2.591-0.919,4.468-3.189,4.881-5.912c0.749-4.92,1.099-9.12,1.099-13.219S173.894,78.829,173.145,73.91z M158.949,93.72l-12.878,4.58c-2.251,0.797-3.982,2.625-4.66,4.92c-1.15,3.889-2.664,7.569-4.504,10.943c-1.142,2.1-1.213,4.619-0.187,6.777l5.841,12.285c-2.822,3.389-5.943,6.515-9.337,9.334l-12.283-5.834c-2.161-1.036-4.672-0.953-6.775,0.185c-3.379,1.838-7.061,3.35-10.953,4.502c-2.29,0.676-4.118,2.406-4.917,4.657l-4.582,12.883c-4.677,0.476-8.503,0.476-13.18,0l-4.582-12.883c-0.8-2.246-2.628-3.982-4.917-4.657c-3.894-1.152-7.579-2.664-10.953-4.502c-2.103-1.147-4.619-1.22-6.775-0.185l-12.283,5.839c-3.391-2.825-6.512-5.946-9.337-9.339l5.841-12.285c1.026-2.159,0.955-4.677-0.187-6.777c-1.835-3.364-3.35-7.049-4.504-10.948c-0.678-2.29-2.411-4.118-4.66-4.915l-12.878-4.58c-0.243-2.343-0.36-4.502-0.36-6.592s0.117-4.244,0.36-6.587l12.881-4.584c2.248-0.797,3.979-2.625,4.657-4.915c1.152-3.889,2.667-7.574,4.504-10.953c1.142-2.095,1.213-4.619,0.187-6.772l-5.841-12.285c2.827-3.393,5.948-6.519,9.337-9.339l12.288,5.839c2.151,1.036,4.677,0.953,6.775-0.185c3.372-1.838,7.054-3.35,10.948-4.502c2.29-0.676,4.118-2.411,4.917-4.657l4.582-12.883c4.633-0.481,8.466-0.481,13.18,0l4.582,12.883c0.8,2.246,2.628,3.982,4.917,4.657c3.894,1.152,7.579,2.664,10.953,4.502c2.103,1.147,4.614,1.22,6.775,0.185l12.283-5.839c3.389,2.82,6.51,5.946,9.337,9.339l-5.841,12.285c-1.026,2.154-0.955,4.677,0.187,6.772c1.843,3.389,3.357,7.069,4.504,10.948c0.678,2.295,2.409,4.123,4.66,4.92l12.878,4.58c0.243,2.343,0.36,4.502,0.36,6.592S159.192,91.377,158.949,93.72z\"/><path d=\"M87.124,50.802c-19.062,0-34.571,15.508-34.571,34.571s15.508,34.571,34.571,34.571s34.571-15.508,34.571-34.571S106.186,50.802,87.124,50.802z M87.124,105.009c-10.827,0-19.636-8.809-19.636-19.636s8.809-19.636,19.636-19.636s19.636,8.809,19.636,19.636S97.951,105.009,87.124,105.009z\"/></svg>');"},{"selector":".ico.fx ","rule":"width: 16px;height: 16px;background-image:url('data:image/svg+xml;utf8,<svg version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"1 1 22 22\"><path d=\"M12.42,5.29C11.32,5.19 10.35,6 10.25,7.11L10,10H12.82V12H9.82L9.38,17.07C9.18,19.27 7.24,20.9 5.04,20.7C3.79,20.59 2.66,19.9 2,18.83L3.5,17.33C3.83,18.38 4.96,18.97 6,18.63C6.78,18.39 7.33,17.7 7.4,16.89L7.82,12H4.82V10H8L8.27,6.93C8.46,4.73 10.39,3.1 12.6,3.28C13.86,3.39 15,4.09 15.66,5.17L14.16,6.67C13.91,5.9 13.23,5.36 12.42,5.29M22,13.65L20.59,12.24L17.76,15.07L14.93,12.24L13.5,13.65L16.35,16.5L13.5,19.31L14.93,20.72L17.76,17.89L20.59,20.72L22,19.31L19.17,16.5L22,13.65Z\"/></svg>');"},{"selector":".ico.focus ","rule":"width: 16px;height: 16px;background-image:url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" version=\"1.1\" viewBox=\"0 0 24 24\"><path d=\"M12,9A3,3 0 0,0 9,12A3,3 0 0,0 12,15A3,3 0 0,0 15,12A3,3 0 0,0 12,9M19,19H15V21H19A2,2 0 0,0 21,19V15H19M19,3H15V5H19V9H21V5A2,2 0 0,0 19,3M5,5H9V3H5A2,2 0 0,0 3,5V9H5M5,15H3V19A2,2 0 0,0 5,21H9V19H5V15Z\"/></svg>');"},{"selector":".ico.goal ","rule":"width: 16px;height: 16px;background-image:url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path d=\"M16,28A12,12,0,1,1,28,16,12,12,0,0,1,16,28ZM16,6A10,10,0,1,0,26,16,10,10,0,0,0,16,6Z\"/><rect height=\"7\" width=\"2\" x=\"15\" y=\"24\"/><rect height=\"7\" width=\"2\" x=\"15\" y=\"1\"/><rect height=\"2\" width=\"7\" x=\"24\" y=\"15\"/><rect height=\"2\" width=\"7\" x=\"1\" y=\"15\"/><path d=\"M16,20a4,4,0,1,1,4-4A4,4,0,0,1,16,20Zm0-6a2,2,0,1,0,2,2A2,2,0,0,0,16,14Z\"/></svg>');"},{"selector":".ico.focusAuto ","rule":"width: 16px;height: 16px;background-image:url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" version=\"1.1\" viewBox=\"0 0 24 24\"><path d=\"M19 19H15V21H19C20.1 21 21 20.1 21 19V15H19M19 3H15V5H19V9H21V5C21 3.9 20.1 3 19 3M5 5H9V3H5C3.9 3 3 3.9 3 5V9H5M5 15H3V19C3 20.1 3.9 21 5 21H9V19H5V15M8 7C6.9 7 6 7.9 6 9V17H8V13H10V17H12V9C12 7.9 11.1 7 10 7H8M8 9H10V11H8V9M13 7V17H15V13H17V11H15V9H18V7H13Z\"/></svg>');"},{"selector":".ico.delete ","rule":"width: 16px;height: 16px;background-image:url('data:image/svg+xml;utf8,<svg version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path d=\"M13.46,12L19,17.54V19H17.54L12,13.46L6.46,19H5V17.54L10.54,12L5,6.46V5H6.46L12,10.54L17.54,5H19V6.46L13.46,12Z\"/></svg>');"},{"selector":".ico.remove ","rule":"width: 16px;height: 16px;background-image:url('data:image/svg+xml;utf8,<svg version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"-18 8 124 124\"><path d=\"M75.6,44.8v73c0,3.4-2.8,6.2-6.2,6.2H21.3c-3.4,0-6.2-2.8-6.2-6.2v-73H75.6L75.6,44.8z M59.9,52.9v62.8h3.6V52.9H59.9  L59.9,52.9z M43.6,52.9v62.8h3.6V52.9H43.6L43.6,52.9z M27.3,52.9v62.8h3.6V52.9H27.3L27.3,52.9z M31.3,27.9v-5.2  c0-3.3,2.6-5.9,5.9-5.9h16.4c3.3,0,5.9,2.6,5.9,5.9v5.2h18.1c3.4,0,6.2,2.8,6.2,6.2v4.3H7V34c0-3.4,2.8-6.2,6.2-6.2H31.3L31.3,27.9z   M37.2,20.8c-1,0-1.8,0.8-1.8,1.8v5.2h20.1v-5.2c0-1-0.8-1.8-1.8-1.8H37.2L37.2,20.8z\"/></svg>');"},{"selector":".ico.collapse ","rule":"width: 16px;height: 16px;background-image:url('data:image/svg+xml;utf8,<svg version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path d=\"M19.92,12.08L12,20L4.08,12.08L5.5,10.67L11,16.17V2H13V16.17L18.5,10.66L19.92,12.08M12,20H2V22H22V20H12Z\"/></svg>');"},{"selector":".ico.heart ","rule":"width: 16px;height: 16px;background-image:url('data:image/svg+xml;utf8,<svg version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"-43 -45 620 620\"><path d=\"M533.333,186.54c0,44.98-19.385,85.432-50.256,113.46h0.256L316.667,466.667C300,483.333,283.333,500,266.667,500c-16.667,0-33.333-16.667-50-33.333L50,300h0.255C19.384,271.972,0,231.52,0,186.54C0,101.926,68.593,33.333,153.206,33.333c44.98,0,85.432,19.384,113.46,50.255c28.028-30.871,68.48-50.255,113.46-50.255C464.74,33.333,533.333,101.926,533.333,186.54z\"/></svg>');"},{"selector":".ico.windowMax ","rule":"width: 16px;height: 16px;background-image:url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"-1 -1 14 14\"><path fill=\"none\" stroke=\"currentColor\"  d=\"M10.5 8.5V10c0 .3-.2.5-.5.5H2c-.3 0-.5-.2-.5-.5V2c0-.3.2-.5.5-.5h1.5M6 6l4-4m-3.5-.5H10c.3 0 .5.2.5.5v3.5\"/></svg>');"},{"selector":".ico.run ","rule":"width: 16px;height: 16px;background-image:url('data:image/svg+xml;utf8,<svg version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\"><path d=\"M31.356,25.677l38.625,22.3c1.557,0.899,1.557,3.147,0,4.046l-38.625,22.3c-1.557,0.899-3.504-0.225-3.504-2.023V27.7   C27.852,25.902,29.798,24.778,31.356,25.677z\"/><path d=\"M69.981,47.977l-38.625-22.3c-0.233-0.134-0.474-0.21-0.716-0.259l37.341,21.559c1.557,0.899,1.557,3.147,0,4.046   l-38.625,22.3c-0.349,0.201-0.716,0.288-1.078,0.301c0.656,0.938,1.961,1.343,3.078,0.699l38.625-22.3   C71.538,51.124,71.538,48.876,69.981,47.977z\"/><path d=\"M31.356,25.677l38.625,22.3c1.557,0.899,1.557,3.147,0,4.046   l-38.625,22.3c-1.557,0.899-3.504-0.225-3.504-2.023V27.7C27.852,25.902,29.798,24.778,31.356,25.677z\"/></svg>');"},{"selector":".ico.createNew ","rule":"width: 16px;height: 16px;background-image:url('data:image/svg+xml;utf8,<svg version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"-40 -40 642 642\"><path d=\"M63.648,506.736h220.32v50.186H29.376c-4.488,0-8.16-1.531-11.016-4.59c-2.856-3.062-4.284-6.834-4.284-11.322V149.94v-29.988v-1.836h0.612c0-0.816,0.408-1.632,1.224-2.448L130.968,2.448V0.612h3.672C135.048,0.204,135.456,0,135.864,0h29.376l1.224,0.612H391.68c4.485,0,8.16,1.428,11.016,4.284c2.856,2.856,4.284,6.528,4.284,11.016v170.136h-49.572V50.184h-186.66v99.756c0,4.08-1.836,6.12-5.508,6.12H63.648V506.736z M534.889,353.125H429.624V247.248c0-5.304-2.649-7.956-7.956-7.956h-74.052c-5.304,0-7.956,2.652-7.956,7.956v105.877H233.784c-5.304,0-7.956,2.648-7.956,7.955v74.053c0,5.303,2.652,7.955,7.956,7.955H339.66v105.877c0,5.303,2.652,7.955,7.956,7.955h74.052c5.307,0,7.956-2.652,7.956-7.955V443.088H534.89c5.304,0,7.956-2.652,7.956-7.955V361.08C542.845,355.775,540.192,353.125,534.889,353.125z\"/></svg>');"},{"selector":".ico.hammer ","rule":"width: 16px;height: 16px;background-image:url('data:image/svg+xml;utf8,<svg version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><path d=\"M30.651,23.538l25.24,24.346l-6.577,6.577l-23.969,-25.617l5.306,-5.306Zm-7.208,3.403l5.306,-5.305c0,0 -2.695,-2.056 -2.447,-3.34c0.248,-1.285 0.809,-3.1 4.711,-4.711c3.903,-1.611 7.543,-1.757 7.543,-1.757l0.131,-1.758c0,0 -8.969,-1.356 -13.707,0.327c-4.738,1.684 -10.097,8.02 -10.097,8.02c0,0 0.935,3.064 -0.667,4.666c-1.601,1.601 -3.754,-0.245 -3.754,-0.245l-2.456,3.118l6.197,6.197l3.112,-2.461c0,0 -1.472,-2.207 -0.017,-3.528c3.132,-2.842 6.145,0.777 6.145,0.777Z\"/></svg>');"},{"selector":".ico.search ","rule":"width: 16px;height: 16px;background-image:url('data:image/svg+xml;utf8,<svg version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path d=\"M27.414,24.586l-5.077-5.077C23.386,17.928,24,16.035,24,14c0-5.514-4.486-10-10-10S4,8.486,4,14  s4.486,10,10,10c2.035,0,3.928-0.614,5.509-1.663l5.077,5.077c0.78,0.781,2.048,0.781,2.828,0  C28.195,26.633,28.195,25.367,27.414,24.586z M7,14c0-3.86,3.14-7,7-7s7,3.14,7,7s-3.14,7-7,7S7,17.86,7,14z\"/></svg>');"},{"selector":".ico.threeDots ","rule":"width: 12px;height: 12px;background-image:url('data:image/svg+xml;utf8,<svg version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 612 612\"><path d=\"M55.636,250.364C24.907,250.364,0,275.27,0,306c0,30.73,24.907,55.636,55.636,55.636S111.273,336.73,111.273,306\t\t\t\tC111.273,275.27,86.366,250.364,55.636,250.364z M315.273,250.364c-30.73,0-55.636,24.907-55.636,55.636\t\t\t\tc0,30.729,24.907,55.636,55.636,55.636c30.729,0,55.636-24.905,55.636-55.636C370.909,275.27,346.003,250.364,315.273,250.364z\t\t\t\t M556.364,250.364c-30.73,0-55.636,24.907-55.636,55.636c0,30.729,24.906,55.636,55.636,55.636\t\t\t\tC587.093,361.636,612,336.73,612,306C612,275.27,587.093,250.364,556.364,250.364z\"/></svg>');"},{"selector":".ico.file_code ","rule":"width: 14px;height: 14px;background-image:url('data:image/svg+xml;utf8,<svg version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 48 48\"><path d=\"M34.521,20.547H12.688c-0.827,0-1.5-0.673-1.5-1.5s0.673-1.5,1.5-1.5h21.834c0.827,0,1.5,0.673,1.5,1.5S35.348,20.547,34.521,20.547z\"/><path d=\"M34.521,27.713H12.688c-0.827,0-1.5-0.673-1.5-1.5s0.673-1.5,1.5-1.5h21.834c0.827,0,1.5,0.673,1.5,1.5C36.021,27.041,35.348,27.713,34.521,27.713z\"/><path d=\"M31.542,34.88H15.667c-0.827,0-1.5-0.673-1.5-1.5s0.673-1.5,1.5-1.5h15.875c0.827,0,1.5,0.673,1.5,1.5S32.369,34.88,31.542,34.88z\"/><path d=\"M40.783,8.692l-7.639-7.31C32.346,0.619,30.804,0,29.699,0H7.774c-1.104,0-2,0.896-2,2v44c0,1.104,0.896,2,2,2h32.453c1.104,0,2-0.896,2-2V12.075C42.228,10.971,41.581,9.456,40.783,8.692z M37.968,41.092c0,1.104-0.896,2-2,2H11.806c-1.104,0-2-0.896-2-2V5.776c0-1.104,0.896-2,2-2h16.518c1.104,0,2,0.896,2,2v3.321c0,1.104,0.896,2,2,2h3.645c1.104,0,2,0.896,2,2V41.092z\"/></svg>');"}];
				let cssStyle$r;
				const css$t = {
					install:() => {
						cssStyle$r = document.createElement("style");
						document.head.appendChild(cssStyle$r);
						const cssStyleSheet = cssStyle$r.sheet;
						rules$r.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/app/appearance/themes/common/css/icoImages.css]:', rules);
					},
					remove:() => {
						if (cssStyle$r) {document.head.removeChild(cssStyle$r);}
					}
				};

	const rules$q = [{"selector":"i.ico ","rule":"filter: brightness(0) invert(1) brightness(100%);"},{"selector":".ico.actionHover:hover ","rule":"filter: invert(35%) sepia(19%) saturate(4417%) hue-rotate(186deg) brightness(98%) contrast(83%);"},{"selector":".ico.errorHover:hover ","rule":"filter: invert(28%) sepia(96%) saturate(6757%) hue-rotate(356deg) brightness(93%) contrast(120%);"}];
				let cssStyle$q;
				const css$s = {
					install:() => {
						cssStyle$q = document.createElement("style");
						document.head.appendChild(cssStyle$q);
						const cssStyleSheet = cssStyle$q.sheet;
						rules$q.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/app/appearance/themes/darcula/css/ico.css]:', rules);
					},
					remove:() => {
						if (cssStyle$q) {document.head.removeChild(cssStyle$q);}
					}
				};

	const rules$p = [{"selector":":root ","rule":"--body-bg-color: #3c3f41;--body-border-color: #353636;--body-border: 1px solid var(--body-border-color);--body-hr-color: #515151;--body-font-size: 12px;--body-text-color: #ccc;--body-text-warning-color: #ff0000;--body-text-description-color: #858585;--body-link-color: #2597ed;--body-link-color-hover: #549bff;--space-bg-color: #2b2b2b;--space-bg-color-hover: #2b2b2b;--space-border: 1px solid var(--body-hr-color);--sidebar-bg-color: #3e434c;--head-bg-color: var(--body-bg-color);--head-text-color: var(--body-text-color);--head-hr-color: var(--body-hr-color);--gutter-bg-color: #313335;--element-bg-color: #4c5052;--element-bg-color-hover: var(--space-bg-color);--element-border-width: 1px;--element-border-color: #686868;--element-border: var(--element-border-width) solid var(--element-border-color);--element-border-radius: 2px;--element-text-color: #eee;--element-text-color-hover: #eee;--element-selected-bg-color: #4b6eae;--element-selected-bg-color-hover: #5e7cb9;--element-selected-text-color: #fff;--input-bg-color: var(--body-bg-color);--input-font-size: var(--body-font-size);--input-text-color: var(--body-text-color);--input-border-color: var(--element-border-color);--input-border-width: 1px;--input-border: var(--input-border-width) solid var(--input-border-color);--input-border-radius: 2px;"}];
				let cssStyle$p;
				const css$r = {
					install:() => {
						cssStyle$p = document.createElement("style");
						document.head.appendChild(cssStyle$p);
						const cssStyleSheet = cssStyle$p.sheet;
						rules$p.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/app/appearance/themes/darcula/css/vars.css]:', rules);
					},
					remove:() => {
						if (cssStyle$p) {document.head.removeChild(cssStyle$p);}
					}
				};

	const css$q = {
		install: () => {
			css$B.install();
			css$A.install();
			css$z.install();
			css$y.install();
			css$x.install();
			css$w.install();
			css$v.install();
			css$u.install();
			css$r.install();
			css$s.install();
			css$t.install();
		},
		remove: () => {
			css$B.remove();
			css$A.remove();
			css$z.remove();
			css$y.remove();
			css$x.remove();
			css$w.remove();
			css$v.remove();
			css$u.remove();
			css$r.remove();
			css$s.remove();
			css$t.remove();
		}
	};

	const rules$o = [{"selector":"i.ico ","rule":""},{"selector":".ico.actionHover:hover ","rule":"filter: invert(35%) sepia(19%) saturate(4417%) hue-rotate(186deg) brightness(98%) contrast(83%);"},{"selector":".ico.errorHover:hover ","rule":"filter: invert(28%) sepia(96%) saturate(6757%) hue-rotate(356deg) brightness(93%) contrast(120%);"}];
				let cssStyle$o;
				const css$p = {
					install:() => {
						cssStyle$o = document.createElement("style");
						document.head.appendChild(cssStyle$o);
						const cssStyleSheet = cssStyle$o.sheet;
						rules$o.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/app/appearance/themes/light/css/ico.css]:', rules);
					},
					remove:() => {
						if (cssStyle$o) {document.head.removeChild(cssStyle$o);}
					}
				};

	const rules$n = [{"selector":":root ","rule":"--body-bg-color: #f1f1f1;--body-border-color: #e4e4e4;--body-border: 1px solid var(--body-border-color);--body-hr-color: #d6d6d6;--body-font-size: 12px;--body-text-color: #020305;--body-text-warning-color: #ff0000;--body-text-description-color: #676767;--body-link-color: #2597ed;--body-link-color-hover: #549bff;--space-bg-color: #fff;--space-bg-color-hover: #d9d9d9;--space-border: 1px solid var(--body-hr-color);--sidebar-bg-color: #e5eaef;--head-bg-color: var(--body-bg-color);--head-text-color: var(--body-text-color);--head-hr-color: var(--body-hr-color);--gutter-bg-color: #f1f1f1;--element-bg-color: var(--space-bg-color);--element-bg-color-hover: var(--space-bg-color-hover);--element-border-width: 1px;--element-border-color: #686868;--element-border: var(--element-border-width) solid var(--element-border-color);--element-border-radius: 2px;--element-text-color: var(--body-text-color);--element-text-color-hover: var(--body-text-color);--element-selected-bg-color: #2876bf;--element-selected-bg-color-hover: #5e7cb9;--element-selected-text-color: #fff;--input-bg-color: var(--space-bg-color);--input-font-size: var(--body-font-size);--input-text-color: var(--body-text-color);--input-border-color: var(--element-border-color);--input-border-width: 1px;--input-border: var(--input-border-width) solid var(--input-border-color);--input-border-radius: 2px;"}];
				let cssStyle$n;
				const css$o = {
					install:() => {
						cssStyle$n = document.createElement("style");
						document.head.appendChild(cssStyle$n);
						const cssStyleSheet = cssStyle$n.sheet;
						rules$n.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/app/appearance/themes/light/css/vars.css]:', rules);
					},
					remove:() => {
						if (cssStyle$n) {document.head.removeChild(cssStyle$n);}
					}
				};

	const css$n = {
		install: () => {
			css$B.install();
			css$A.install();
			css$z.install();
			css$y.install();
			css$x.install();
			css$w.install();
			css$v.install();
			css$u.install();
			css$o.install();
			css$p.install();
			css$t.install();
		},
		remove: () => {
			css$B.remove();
			css$A.remove();
			css$z.remove();
			css$y.remove();
			css$x.remove();
			css$w.remove();
			css$v.remove();
			css$u.remove();
			css$o.remove();
			css$p.remove();
			css$t.remove();
		}
	};

	css$C.install();

	/** Settings */
	const Appearance = class extends HTMLElement {
		#$content;

		constructor() {
			super();
			this.#$content = new Tpl_setting_appearance(settings$1.model.data.appearance);
			this.appendChild(this.#$content);

			//Run commands for changes
			const cmds = [
				['editor.setTheme', 'general.theme'],
				['editor.showGutter', 'uiOptions.showGutter'],
				['editor.showLineNumbers', 'uiOptions.showLineNumbers'],
				['editor.showIndent', 'uiOptions.showIndent'],
				['editor.showStatusBar', 'uiOptions.showStatusBar'],
				['editor.showToolBar', 'toolWindows.showToolBar']
			];

			cmds.forEach(([commandName, settingsPath]) => {
				this.#$content.model.addEventListener('change', settingsPath, (cfg) => {
					Command.exec(commandName, cfg.newValue);
				});
			});
		}
	};

	customElements.define('x-ide-settings-appearance', Appearance);

	settings$1.define({
		name: 'Appearance',
		path: 'appearance',
		struct: {
			general: {
				syncThemeWithOs: false,
				theme: 'darcula',
				fontSize: 14
			},
			uiOptions: {
				showGutter: true,
				showLineNumbers: true,
				showIndent: true,
				showStatusBar: true,
			},
			toolWindows: {
				showToolBar: true
			}
		},
		$settings: Appearance
	});


	/** Set current theme */
	(() => {
		let currentThemeCss;
		new Command('editor.setTheme', themeName => {
			if (currentThemeCss) {
				currentThemeCss.remove();
			}
			currentThemeCss = {darcula: css$q, light: css$n}[themeName];
			currentThemeCss.install();
			settings$1.model.data.appearance.general.theme = themeName;
		});
		Command.exec('editor.setTheme', settings$1.model.data.appearance.general.theme);
	})();

	new Command('editor.fontSize', value => {
		settings$1.model.data.appearance.general.fontSize = value;
	});

	new Command('editor.showGutter', value => {
		if (value !== true && value !== false) {
			value = !settings$1.model.data.appearance.uiOptions.showGutter;			//invert value
		}
		settings$1.model.data.appearance.uiOptions.showGutter = value;
		return value;
	});

	new Command('editor.showLineNumbers', value => {
		if (value !== true && value !== false) {
			value = !settings$1.model.data.appearance.uiOptions.showLineNumbers;		//invert value
		}
		settings$1.model.data.appearance.uiOptions.showLineNumbers = value;
		return value;
	});

	new Command('editor.showIndent', value => {
		if (value !== true && value !== false) {
			value = !settings$1.model.data.appearance.uiOptions.showIndent;			//invert value
		}
		settings$1.model.data.appearance.uiOptions.showIndent = value;
		return value;
	});

	new Command('editor.showStatusBar', value => {
		if (value !== true && value !== false) {
			value = !settings$1.model.data.appearance.uiOptions.showStatusBar;			//invert value
		}
		settings$1.model.data.appearance.uiOptions.showStatusBar = value;
		return value;
	});

	new Command('editor.showToolBar', value => {
		if (value !== true && value !== false) {
			value = !settings$1.model.data.appearance.toolWindows.showToolBar;			//invert value
		}
		settings$1.model.data.appearance.toolWindows.showToolBar = value;
		return value;
	});


	/*
	if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
		// dark mode
	} else {
		// light
	}

	window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
		const newColorScheme = e.matches ? "dark" : "light";
	});
	 */

	const rules$m = [{"selector":"x-tpl_setting_keymap x-tree ","rule":"overflow: auto;max-height: 320px;display: block;border: 1px solid var(--body-hr-color);"},{"selector":"x-tpl_setting_keymap x-tree x-tpl_tree_item .hint ","rule":"float: right;margin-right: 20px;"},{"selector":"x-tpl_setting_keymap x-tree x-tpl_tree_item .hint span ","rule":"background: var(--element-bg-color);border: var(--element-border);margin-left: 5px;padding: 1px 3px;"}];
				let cssStyle$m;
				const css$m = {
					install:() => {
						cssStyle$m = document.createElement("style");
						document.head.appendChild(cssStyle$m);
						const cssStyleSheet = cssStyle$m.sheet;
						rules$m.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/app/keymap/keymap.css]:', rules);
					},
					remove:() => {
						if (cssStyle$m) {document.head.removeChild(cssStyle$m);}
					}
				};

	let Tpl_setting_keymap = class extends RP {
						constructor(model, logic) {
							const tree = {"vDom":{"tree":[{"type":"tag","tagName":"h2","attrs":{},"childNodes":[{"type":"textNode","value":"Keymap"}]},{"type":"tag","tagName":"h3","attrs":{},"childNodes":[{"type":"textNode","value":"Keymap settings"}]},{"type":"component","tagName":"x-tree","attrs":{"value":{"valueOutRender":"m.keymapTree","modelDepends":[{"refName":"m","modelPath":"keymapTree","valueOutRender":"m.keymapTree","jsonInnerPath":""}],"modelOut":[{"refName":"m","modelPath":"keymapTree"}],"type":"json"}},"childNodes":[]}]}};
							super(tree, model, logic);
						}
					};
					customElements.define('x-tpl_setting_keymap', Tpl_setting_keymap);

	const rules$l = [{"selector":"x-contextmenu ","rule":"position: absolute;background: var(--element-bg-color);border: var(--element-border);z-index: 10000;"},{"selector":"x-contextmenu x-menu-item ","rule":"position: relative;display: block;font-size: 12px;cursor: default;"},{"selector":"x-contextmenu x-menu-item > div ","rule":"padding: 6px 10px 4px;"},{"selector":"x-contextmenu x-menu-item:hover ","rule":"background: var(--element-selected-bg-color);"}];
				let cssStyle$l;
				const css$l = {
					install:() => {
						cssStyle$l = document.createElement("style");
						document.head.appendChild(cssStyle$l);
						const cssStyleSheet = cssStyle$l.sheet;
						rules$l.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/ui/contextMenu/contextMenu.css]:', rules);
					},
					remove:() => {
						if (cssStyle$l) {document.head.removeChild(cssStyle$l);}
					}
				};

	css$l.install();

	/**
	 * @example
	 * 		const data = [
	 * 			{ico, title, action:Function, childNodes:[ ... ] }
	 * 		];
	 * 		const cfg = {
	 * 			x: number,
	 * 			y: number
	 * 		}
	 * 		new ContextMenu(data, cfg);
	 */

	class ContextMenu extends HTMLElement {
		#data;
		#cfg;
		#closeChecker;

		constructor(data, cfg) {
			super();

			this.#data = data;
			this.#cfg = cfg;
			this.#render(data, this);

			this.style.left = cfg.x + 'px';
			this.style.top = cfg.y + 'px';

			this.#closeChecker = (e) => {
				if (!isChildOf(e.target, this)) {
					this.close();
				}
			};

			setTimeout(() => {
				document.body.appendChild(this);
			}, 1);
		}


		connectedCallback() {
			document.addEventListener('click', this.#closeChecker, true);
			document.addEventListener('contextmenu', this.#closeChecker, true);
		}

		disconnectedCallback() {
			document.removeEventListener('click', this.#closeChecker, true);
			document.removeEventListener('contextmenu', this.#closeChecker, true);
		}

		close() {
			document.body.removeChild(this);
		}

		#render(data, $container, path) {
			//console.log('[menu] render data:', data, container, path);
			data.forEach((value) => {
				let $item = document.createElement('x-menu-item');
				let $title = document.createElement('div');
				$title.innerText = value.title;
				$item.appendChild($title);
				$item.addEventListener('click', () => {
					this.close();
					value.action();
				});
				$container.appendChild($item);
			});
		}
	}

	customElements.define('x-contextmenu', ContextMenu);

	const rules$k = [{"selector":"x-tpl_addkeymap ","rule":"display: block;padding: 20px;"},{"selector":"x-tpl_addkeymap .key ","rule":"margin-top: 10px;"},{"selector":"x-tpl_addkeymap .control ","rule":"float: right;"},{"selector":"x-tpl_addkeymap .control button ","rule":"margin: 20px 0 0 10px;"}];
				let cssStyle$k;
				const css$k = {
					install:() => {
						cssStyle$k = document.createElement("style");
						document.head.appendChild(cssStyle$k);
						const cssStyleSheet = cssStyle$k.sheet;
						rules$k.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/modal/settings/addKeymap/addKeymap.css]:', rules);
					},
					remove:() => {
						if (cssStyle$k) {document.head.removeChild(cssStyle$k);}
					}
				};

	let Tpl_addKeymap = class extends RP {
						constructor(model, logic) {
							const tree = {"vDom":{"tree":[{"type":"tag","tagName":"div","attrs":{},"childNodes":[{"type":"tag","tagName":"div","attrs":{},"childNodes":[{"type":"textNode","value":"Press any key to set a hotkey for the action"}]},{"type":"tag","tagName":"div","attrs":{},"childNodes":[{"type":"textNode","value":"`"},{"type":"splitNode"},{"type":"textNode","value":"","placeNum":11,"valueInRender":null,"valueOutRender":"m.title","modelDepends":[{"refName":"m","modelPath":"title","canSync":true}]},{"type":"splitNode"},{"type":"textNode","value":"`"}]},{"type":"tag","tagName":"div","attrs":{"class":{"value":"input key","type":"string"}},"childNodes":[{"type":"splitNode"},{"type":"textNode","value":"","placeNum":12,"valueInRender":null,"valueOutRender":"m.key","modelDepends":[{"refName":"m","modelPath":"key","canSync":true}]},{"type":"splitNode"}]}]},{"type":"tag","tagName":"div","attrs":{"class":{"value":"control","type":"string"}},"childNodes":[{"type":"tag","tagName":"button","attrs":{"class":{"value":"big main","type":"string"},"onclick":{"type":"event","fn":"self.create();"}},"childNodes":[{"type":"textNode","value":"OK"}]},{"type":"tag","tagName":"button","attrs":{"class":{"value":"big","type":"string"},"onclick":{"type":"event","fn":"self.cancel();"}},"childNodes":[{"type":"textNode","value":"Cancel"}]}]}]}};
							super(tree, model, logic);
						}
					};
					customElements.define('x-tpl_addkeymap', Tpl_addKeymap);

	css$k.install();


	/**
	 * @param cfg				{Object}
	 * @param cfg.title			{String}
	 * @param cfg.onCreate		{Function}
	 * @param keymap			{Object}
	 */
	const addKeymap = (cfg, keymap) => new (class {
		#$window;
		#$keymap;
		#cfg;

		constructor() {
			keymap.disable();
			this.#cfg = cfg;
			this.#$keymap = new Tpl_addKeymap({title: cfg.title, key: '', keyHash: ''}, this);
			this.#$window = new Window({
				title: 'Keyboard Shortcut',
				width: 340,
				height: 150,
				uiLock: true,
				$content: this.#$keymap,
				onClose: () => {
					keymap.enable();
				}
			});

			document.addEventListener('keydown', (e) => {
				if (e.code.indexOf('Control')!==-1 || e.code.indexOf('Shift')!==-1 || e.code.indexOf('Alt')!==-1) {
					return;
				}
				const keyHash = `${e.ctrlKey ? 'ctrl+':''}${e.shiftKey ? 'shift+':''}${e.altKey ? 'alt+':''}${e.code}`;
				this.#$keymap.model.data.keyHash = keyHash;
				this.#$keymap.model.data.key = keyHash.replace('Key', '').replace(/\+/g, ' + ');
			}, true);
		};

		onKeyDown(e) {
			if (e.code === "Enter") {
				this.create();
			}
		}

		create() {
			keymap.enable();
			this.#$window.close();
			this.#cfg.onCreate(this.#$keymap.model.data.keyHash);
		}

		cancel() {
			this.#$window.close();
		}
	})();

	css$m.install();

	let keysByCommand = {};
	let commandByKeys = {};
	let $keymapTree;

	const keymap = new (class {
		#status = true;

		constructor() {
			document.body.addEventListener('keydown', e => {
				let keyHash = this.#keyHash({code: e.code, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey});
				if (e.ctrlKey || e.code.match(/^F\d+$/) || e.code === 'Tab') {
					if (['INPUT', 'TEXTAREA'].indexOf(e.target.tagName) === -1 || e.target.className.indexOf('ace_text') !==-1) {
						//console.log('preventDefault');
						e.preventDefault();
					}
				}

				if (!this.#status) {
					return;
				}

				const cmd = commandByKeys[keyHash];
				if (cmd) {
					Command.exec(cmd);
				}
				return false;
			}, true);

			if (settings$1.model.data['keymap'] && settings$1.model.data['keymap']['mapping']) {
				commandByKeys = settings$1.model.data['keymap']['mapping'];
				Object.entries(commandByKeys).forEach(([keyHash, command]) => {
					if (keysByCommand[command]) {
						keysByCommand[command].push(keyHash);
					} else {
						keysByCommand[command] = [keyHash];
					}
				});

			} else {	//add default hotkeys
				console.log('[Keymap] Add default hotkeys');
				settings$1.model.data['keymap'] = {mapping: {}};
				this.add('ctrl+KeyZ', "editor.undo");
				this.add('ctrl+shift+KeyZ', "editor.redo");
				this.add('ctrl+KeyF', "editor.find");
				this.add('ctrl+KeyR', "editor.replace");
				this.add('ctrl+KeyD', "editor.copylinesdown");
				this.add('shift+Delete', "editor.removeline");
				this.add('shift+alt+ArrowDown', "editor.movelinesdown");
				this.add('shift+alt+ArrowUp', "editor.movelinesup");
				this.add('ArrowLeft', "editor.gotoleft");
				this.add('ArrowRight', "editor.gotoright");
				this.add('ArrowUp', "editor.golineup");
				this.add('ArrowDown', "editor.golinedown");
				this.add('PageUp', "editor.gotopageup");
				this.add('PageDown', "editor.gotopagedown");
				this.add('Home', "editor.gotostart");
				this.add('End', "editor.gotoend");
				this.add('Tab', "editor.indent");
				this.add('shift+Tab', "editor.outdent");
				this.add('Delete', "editor.del");
				this.add('Backspace', "editor.backspace");
				this.add('ctrl+ArrowLeft', "editor.gotowordleft");
				this.add('ctrl+ArrowRight', "editor.gotowordright");
				this.add('ctrl+shift+ArrowLeft', "editor.selectwordleft");
				this.add('ctrl+shift+ArrowRight', "editor.selectwordright");

				this.add('ctrl+KeyA', "editor.selectall");
				this.add('ctrl+KeyC', "editor.copy");
				this.add('ctrl+KeyX', "editor.cut");
				this.add('ctrl+KeyV', "editor.paste");
				this.add('shift+ArrowLeft', "editor.selectleft");
				this.add('shift+ArrowRight', "editor.selectright");
				this.add('shift+ArrowUp', "editor.selectup");
				this.add('shift+ArrowDown', "editor.selectdown");
			}
		}

		enable() {
			this.#status = true;
		}

		disable() {
			this.#status = false;
		}

		#keyHash(keys) {
			return (Array.isArray(keys) ? keys : [keys]).map(value => {
					return typeof value === 'string' ? `${value}` : `${value.ctrl ? 'ctrl+':''}${value.shift ? 'shift+':''}${value.alt ? 'alt+':''}${value.code}`;
				})
				.sort()
				.join("|");
		}

		add(keys, commandName) {
			const keyHash = this.#keyHash(keys);
			commandByKeys[keyHash] = commandName;
			if (keysByCommand[commandName]) {
				keysByCommand[commandName].push(keyHash);
			} else {
				keysByCommand[commandName] = [keyHash];
			}
			settings$1.model.data['keymap']['mapping'][keyHash] = commandName;
			if ($keymapTree) {
				$keymapTree.reflow();
			}
		}

		remove(keyHash, commandName) {
			delete commandByKeys[keyHash];
			let index = keysByCommand[commandName].indexOf(keyHash);
			if (index !== -1) {
				keysByCommand[commandName].splice(index, 1);
			}
			settings$1.model.data['keymap']['mapping'] = commandByKeys;
			//console.log('settingsService.model.data:', settingsService.model.data['keymap']['mapping']);

			if ($keymapTree) {
				$keymapTree.reflow();
			}
		}
	})();



	/**
	 * @description Settings for keymap
	 */
	let keymapTree = [];
	let editorCommands = [
		{
			title: "UI options",
			childNodes: [
				["Show gutter", "editor.showGutter"],
				["Show line numbers", "editor.showLineNumbers"],
				["Show tree indent guides", "editor.showIndent"],
				["Show status bar", "editor.showStatusBar"]
			]
		},
		{
			title: "Editor actions",
			childNodes: [
				["Undo", "editor.undo"],
				["Redo", "editor.redo"],
				["Find", "editor.find"],
				["Replace", "editor.replace"],
				["Copy lines down", "editor.copylinesdown"],
				["Remove line", "editor.removeline"],
				["Move lines down", "editor.movelinesdown"],
				["Move lines up", "editor.movelinesup"],
				["Go to left", "editor.gotoleft"],
				["Go to right", "editor.gotoright"],
				["Go line up", "editor.golineup"],
				["Go line down", "editor.golinedown"],
				["Go to page up", "editor.gotopageup"],
				["Go to page down", "editor.gotopagedown"],
				["Go to start", "editor.gotostart"],
				["Go to end", "editor.gotoend"]
			]
		}
	];

	const addBranch = (parent, nodeCfg) => {
		if (Array.isArray(nodeCfg)) {
			const [title, commandName] = nodeCfg;
			parent.push({
				title: title,
				value: commandName,
				hint: () => {
					const keysHash = keysByCommand[commandName];
					if (keysHash && keysHash.length) {
						const $tagsContainer = document.createElement("div");
						keysHash.forEach(keyHash => {
							let $tag = document.createElement("span");
							$tag.innerHTML = keyHash.replace('Key', '').replace(/\+/g, ' + ');
							$tagsContainer.appendChild($tag);
						});
						return $tagsContainer;
					}
				},
				onContextMenu: (path) => {
					const command = path.match(/(^|\/)([^\/]+)$/)[2];
					const menu = [
						{
							title: 'Add keyboard shortcut',
							action: () => {
								addKeymap({
									title: title,
									onCreate: (key) => {
										console.log('new key:', key);
										keymap.add(key, commandName);
									}
								}, keymap);
							}
						}
					];
					const keys = keysByCommand[command];
					if (keys && keys.length) {								//context menu for folders
						if (path.indexOf('/') !== -1) {
							keys.forEach(key => {
								menu.push({
									title: 'Remove ' + key.replace('Key', ''),
									action: () => {
										keymap.remove(key, commandName);
									}
								});
							});
						}
					}
					new ContextMenu(menu, {
						x: mouse.pageX,
						y: mouse.pageY
					});
				}
			});

		} else {
			const branch = {
				title: nodeCfg.title,
				isDirectory: true,
				isExpanded: true,
				childNodes: []
			};
			parent.push(branch);

			nodeCfg.childNodes.forEach(childCfg => {
				addBranch(branch.childNodes, childCfg);
			});
		}
	};

	editorCommands.forEach(nodeCfg => {
		addBranch(keymapTree, nodeCfg);
	});


	const KeymapSettings = class extends HTMLElement {
		#$content;

		constructor() {
			super();
			this.#$content = new Tpl_setting_keymap({
				keymapTree: keymapTree
			});
			$keymapTree = this.#$content.querySelector("x-tree");
			this.appendChild(this.#$content);
		}
	};

	customElements.define('x-ide-settings-keymap', KeymapSettings);

	settings$1.define({
		name: 'Keymap',
		path: 'keymap',
		struct: {},
		$settings: KeymapSettings
	});

	const rules$j = [{"selector":"x-panelspace ","rule":"display: block;width: 100%;height: 100%;"},{"selector":"x-panelspace > * ","rule":"width: 100%;height: 100%;"},{"selector":"x-panelspace x-panels-panel[name='left'] ","rule":"border-right: 1px solid var(--body-border-color);"},{"selector":"x-panelspace x-panels-panel[name='leftContent'] ","rule":"border-right: 1px solid var(--body-border-color);position: relative;"},{"selector":"x-panelspace x-panels-panel[name='right'] ","rule":"border-left: 1px solid var(--body-border-color);"},{"selector":"x-panelspace x-panels-panel[name='rightContent'] ","rule":"border-left: 1px solid var(--body-border-color);position: relative;"},{"selector":"x-panelspace x-panels-panel[name='top'] ","rule":"border-bottom: 1px solid var(--body-border-color);"},{"selector":"x-panelspace x-panels-panel[name='topContent'] ","rule":"border-bottom: 1px solid var(--body-border-color);position: relative;"},{"selector":"x-panelspace x-panels-panel[name='bottom'] ","rule":"border-top: 1px solid var(--body-border-color);"},{"selector":"x-panelspace x-panels-panel[name='bottomContent'] ","rule":"border-top: 1px solid var(--body-border-color);position: relative;"},{"selector":"x-panels-panel > x-draggable ","rule":"display: block;width: 100%;height: 100%;"},{"selector":"x-panelspace x-panels-panel x-draggable[orientation='horizontal'] x-panelspace-paneltile ","rule":"display: block;margin: 2px 10px;"},{"selector":"x-panelspace x-panels-panel x-draggable[orientation='verticalLeft'] x-panelspace-paneltile,x-panelspace x-panels-panel x-draggable[orientation='verticalRight'] x-panelspace-paneltile ","rule":"display: block;margin: 10px 2px;"},{"selector":"x-panelspace x-panels-panel x-draggable x-draggable-item.active ","rule":"background: var(--space-bg-color);"},{"selector":".x-draggable-phantom ","rule":"background: var(--space-bg-color);border: 1px solid var(--body-border-color);"},{"selector":"\tx-panelspace x-panels-panel .menu ","rule":"background: var(--body-bg-color);border-bottom: 1px solid var(--body-border-color);height: 26px;box-sizing: border-box;"},{"selector":"x-panelspace x-panels-panel .menu > item ","rule":"display: inline-block;margin-top: 1px;height: 26px;padding: 4px 6px;box-sizing: border-box;"},{"selector":"x-panelspace x-panels-panel .menu > item:hover ","rule":"background: var(--element-bg-color);border-radius: var(--element-border-radius);"},{"selector":"x-panelspace x-panels-panel .menu > item > * ","rule":"vertical-align: middle;display: inline-block;"}];
				let cssStyle$j;
				const css$j = {
					install:() => {
						cssStyle$j = document.createElement("style");
						document.head.appendChild(cssStyle$j);
						const cssStyleSheet = cssStyle$j.sheet;
						rules$j.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/ui/panelspace/panelspace.css]:', rules);
					},
					remove:() => {
						if (cssStyle$j) {document.head.removeChild(cssStyle$j);}
					}
				};

	const rules$i = [{"selector":"x-panels ","rule":"display: grid;grid-gap: 0;height: 100%;width: 100%;"}];
				let cssStyle$i;
				const css$i = {
					install:() => {
						cssStyle$i = document.createElement("style");
						document.head.appendChild(cssStyle$i);
						const cssStyleSheet = cssStyle$i.sheet;
						rules$i.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/ui/panels/panels.css]:', rules);
					},
					remove:() => {
						if (cssStyle$i) {document.head.removeChild(cssStyle$i);}
					}
				};

	const rules$h = [{"selector":"x-panels-panel ","rule":"overflow-y: auto;"},{"selector":"x-panels-panel x-panels-panelsplitter ","rule":"position: absolute;background: gray;"},{"selector":"x-panels-panel x-panels-panelsplitter:not(:hover) ","rule":"opacity: 0;"},{"selector":"x-panels-panel x-panels-panelsplitter:hover ","rule":"opacity: 0.5;"},{"selector":"x-panels-panel x-panels-panelsplitter.top ","rule":"cursor: row-resize;top: -3px;height: 5px;width: 100%;"},{"selector":"x-panels-panel x-panels-panelsplitter.bottom ","rule":"cursor: row-resize;bottom: -4px;height: 6px;width: 100%;"},{"selector":"x-panels-panel x-panels-panelsplitter.left ","rule":"cursor: col-resize;left: -4px;top: 0;width: 6px;height: 100%;"},{"selector":"x-panels-panel x-panels-panelsplitter.right ","rule":"cursor: col-resize;right: -4px;top: 0;width: 6px;height: 100%;"}];
				let cssStyle$h;
				const css$h = {
					install:() => {
						cssStyle$h = document.createElement("style");
						document.head.appendChild(cssStyle$h);
						const cssStyleSheet = cssStyle$h.sheet;
						rules$h.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/ui/panels/panel/panel.css]:', rules);
					},
					remove:() => {
						if (cssStyle$h) {document.head.removeChild(cssStyle$h);}
					}
				};

	css$h.install();


	class Panel extends HTMLElement {
		slug;
		cfg;
		panelId;
		#visibility;
		#$splitter;

		/**
		 * @param cfg			{Object}
		 * @param cfg.name		{String}
		 * @param cfg.resizable	{String}
		 * @param cfg.height	{String}
		 * @param cfg.width		{String}
		 */
		constructor(cfg) {
			super();
			this.cfg = cfg;
			let id = inum();
			this.panelId = cfg.name;
			this.slug = 'panel' + id + '_' + cfg.name;
			this.style['grid-area'] = this.slug;
			this.setAttribute('name', cfg.name);

			this.#visibility = {
				enabled: true,
				property: cfg.height ? 'height' : 'width',									//animate property for show/hide
				defaultValue: cfg.height ? cfg.height : cfg.width							//
			};
		}

		connectedCallback() {
			if (this.cfg.resizable && this.previousSibling) {								//
				this.#splitterCreate();
			}
		}

		#splitterCreate() {
			this.#$splitter = document.createElement('x-panels-panelsplitter');
			this.#$splitter.className = this.cfg.resizable;
			this.appendChild(this.#$splitter);
			let direction;
			let metric = (this.cfg.height && this.cfg.height.indexOf('%') !== -1) ? '%' : 'px';
			if (this.cfg.resizable === 'top' || this.cfg.resizable === 'bottom') {
				this.#$splitter.addEventListener('mousedragstart', e => {
					document.body.classList.add('cursorResizeRow');
				});
				direction = this.cfg.resizable === 'top' ? 1 : -1;
				this.#$splitter.addEventListener('mousedrag', e => {
					if (metric === '%') {
						this.dispatchEvent(new CustomEvent('sizeRepartition', {
							detail: {
								propName: 'height',
								position: this.cfg.resizable,
								valueDelta: -(100 / this.parentNode['clientHeight'] * e.detail.stepOffsetY * direction)
							}
						}));
					} else {
						this.dispatchEvent(new CustomEvent('sizeChange', {
							detail: {
								propName: 'height',
								value: (Number.parseFloat(this.cfg.height) - e.detail.stepOffsetY * direction) + metric
							}
						}));
					}
				});
			} else if (this.cfg.resizable === 'left' || this.cfg.resizable === 'right') {
				this.#$splitter.addEventListener('mousedragstart', e => {
					document.body.classList.add('cursorResizeCol');
				});
				direction = this.cfg.resizable === 'left' ? 1 : -1;
				this.#$splitter.addEventListener('mousedrag', e => {
					this.dispatchEvent(new CustomEvent('sizeChange', {
						detail: {
							propName: 'width',
							value: (Number.parseFloat(this.cfg.width) - e.detail.stepOffsetX * direction) + metric
						}
					}));
				});
			}
			this.#$splitter.addEventListener('mousedragstop', e => {
				document.body.classList.remove('cursorResizeRow');
				document.body.classList.remove('cursorResizeCol');
			});
		}

		appendChild(newChild) {
			super.appendChild(newChild);
			if (newChild !== this.#$splitter && this.#$splitter) {
				super.appendChild(this.#$splitter);
			}
		}

		show() {
			if (!this.#visibility.enabled) {
				this.#visibility.enabled = true;
				//console.log('show:', this, this.#visibility.property, 'value:', this.#visibility.defaultValue);
				this.dispatchEvent(new CustomEvent('sizeChange', {
					detail: {
						propName: this.#visibility.property,
						value: this.#visibility.defaultValue
					}
				}));
				this.style.display = 'grid';
			}
		}

		hide() {
			if (this.#visibility.enabled) {
				this.#visibility.enabled = false;
				this.#visibility.defaultValue = this.cfg[this.#visibility.property];
				//console.log('hide:', this, this.#visibility.property);
				this.dispatchEvent(new CustomEvent('sizeChange', {
					detail: {
						propName: this.#visibility.property,
						value: 0
					}
				}));
				this.style.display = 'none';
			}
		}
	}

	customElements.define('x-panels-panel', Panel);

	css$i.install();


	/**
	 * 	<x-panels value:="m.config"></x-panels>
	 *
	 * 		config = [
	 *			[
	 *				{barTop: {height: "20px", repeat: 5}}
	 *			],
	 *			[
	 *				{barLeft: {width: "20px"}},
	 *				{barTopContent: {height: "50px", resizable: "bottom", repeat: 3}},
	 *				{barRight: {width: "20px"}}
	 *			],
	 *			[
	 *				{barLeft: {}},
	 *				{barLeftContent: {width: "50px", resizable: "right"}},
	 *				{tabsArea: {width: "auto", height: "auto"}},
	 *				{barRightContent: {width: "50px", resizable: "left"}},
	 *				{barRight: {}}
	 *			],
	 *			[
	 *				{barBottomContent: {height: "50px", resizable: "top", repeat: 5}}
	 *			],
	 *			[
	 *				{barBottom: {height: "20px", repeat: 5}}
	 *			]
	 *		]);
	 *
	 * Events:
	 * 		$panel.resize				//
	 * 		$panel.sizeChange			//
	 * 		$panel.sizeRepartition		//
	 */

	class Panels extends HTMLElement {
		panels = {};
		#areaConfig = {
			areaTemplate: [],
			areaPanelRef: [],
			rows: [],
			columns: [],
			mainProps: {}					//property for show/hide enum(width,height)
		};

		constructor(model) {
			super();
			if (model) {
				this.init(model.data.value);
			}
		}

		configure(cfg) {
		}

		init(configRaw) {
			configRaw.forEach((items, rowNum) => {
				let row = [];
				let rowPanelsRef = [];
				let colNum = 0;
				items.forEach(item => {
					let name = Object.keys(item)[0];
					let itemCfg = item[name];
					itemCfg.name = name;
					itemCfg.rowNum = rowNum;
					itemCfg.colNum = colNum;
					let $panel = this.panels[name];
					if (!$panel) {
						$panel = this.panels[name] = this.#panelCreate(itemCfg);
					}
					let slug = $panel.slug;
					row[colNum] = slug;
					rowPanelsRef[colNum] = $panel;
					if (itemCfg.repeat) {
						itemCfg.repeat = +itemCfg.repeat;					//to Int
						for (let k = 1; k < itemCfg.repeat; k++) {
							row[colNum + k] = slug;
							rowPanelsRef[colNum + k] = $panel;
						}
						colNum += itemCfg.repeat - 1;
					}
					if (itemCfg.height) {
						this.#areaConfig.rows[rowNum] = itemCfg.height;
					}
					if (itemCfg.width) {
						this.#areaConfig.columns[colNum] = itemCfg.width;
					}
					colNum++;
				});
				this.#areaConfig.areaTemplate.push(row);
				this.#areaConfig.areaPanelRef.push(rowPanelsRef);
				rowNum++;
			});

			this.#reflow();
		}

		panelGet(panelId) {
			if (this.panels[panelId]) {
				return this.panels[panelId];
			} else {
				throw new Error('panel is not exist: ' + panelId);
			}
		}

		/**
		 * @description add panel
		 * @param cfg			{Object}
		 * @param cfg.name		{String}
		 * @param cfg.position	{String}
		 * @param cfg.size		{String}
		 * @param cfg.resizable	{Boolean}
		 */
		panelAdd(cfg) {
			let itemCfg = {};
			let newSizes = [];

			if (cfg.size === 'proportion') {
				this.#areaConfig.rows.forEach((value, num) => {
					value = Number.parseInt(value);
					newSizes[num] = value * (this.#areaConfig.rows.length) / (this.#areaConfig.rows.length + 1) + '%';		//free (1/this.#areaConfig.rows) of space
				});
				itemCfg.height = newSizes.reduce((a, b) => a - Number.parseFloat(b), 100) + '%';
			}

			if (cfg.position === 'bottom') {			//TODO: position: top, left, right
				itemCfg.rowNum = this.#areaConfig.rows.length;
				itemCfg.colNum = 0;
				if (cfg.resizable) {
					itemCfg.resizable = 'top';
				}
				this.#areaConfig.rows.push(0);
				newSizes.push(itemCfg.height);			//add size to new panel
			}
			itemCfg.name = cfg.name;
			let $panel = this.panels[cfg.name] = this.#panelCreate(itemCfg);

			if (cfg.position === 'bottom') {
				this.#areaConfig.areaTemplate.push([$panel.slug]);
				this.#areaConfig.areaPanelRef.push([$panel]);
				this.#areaResize('vertical', newSizes);
			}
			return $panel;
		}

		#panelCreate(itemCfg) {
			let $panel = new Panel(itemCfg);
			this.appendChild($panel);
			$panel.addEventListener('sizeChange', e => {
				itemCfg[e.detail['propName']] = e.detail.value;
				if (e.detail['propName'] === 'height') {
					this.#areaConfig.rows[itemCfg.rowNum] = e.detail.value;
				} else if (e.detail['propName'] === 'width') {
					this.#areaConfig.columns[itemCfg.colNum] = e.detail.value;
				}
				this.#reflow();
			});
			$panel.addEventListener('sizeRepartition', e => {
				//console.log('sizeRepartition', e.detail, 'itemCfg:', itemCfg);
				if (e.detail['propName'] === 'height') {
					let neighbour = e.detail.position === 'top' ? -1 : 1;
					this.#rowSizeChange(itemCfg.rowNum, 'height', e.detail.valueDelta, '%');
					this.#rowSizeChange(itemCfg.rowNum + neighbour, 'height', -e.detail.valueDelta, '%');
				} else if (e.detail['propName'] === 'width') ;
				this.#reflow();
			});
			return $panel;
		}

		#panelByRowGet(rowNum) {
			return this.#areaConfig.areaPanelRef[rowNum][0];
		}

		#rowSizeSet(rowNum, value) {
			this.#areaConfig.rows[rowNum] = value;	//Number.parseInt(e.detail.originValue) + e.detail.valueDelta + '%';
			let $panel = this.#panelByRowGet(rowNum);
			$panel.cfg.height = value;
		}

		#rowSizeChange(rowNum, property, delta, metric) {
			let $panel = this.#panelByRowGet(rowNum);
			let value = (Number.parseFloat($panel.cfg[property]) + delta) + metric;
			$panel.cfg.height = value;
			this.#areaConfig.rows[rowNum] = value;	//Number.parseInt(e.detail.originValue) + e.detail.valueDelta + '%';
		}

		#reflow() {
			//console.log('reflow:', this.#areaConfig);
			this.style['grid-template-rows'] = this.#areaConfig.rows.join(' ');
			this.style['grid-template-columns'] = this.#areaConfig.columns.join(' ');
			this.style['grid-template-areas'] = this.#areaConfig.areaTemplate.map(row => {
				return '"' + row.join(' ') + '"';
			}).join(' ');
		}


		#areaResize(orientation, newSizes) {
			//console.log('[Panels] areaResize, oldSizes:', JSON.stringify(this.#areaConfig.rows), 'newSizes:', JSON.stringify(newSizes));
			if (orientation === 'vertical') {
				this.#areaConfig.rows = newSizes;
				newSizes.forEach((size, rowNum) => {
					//TODO: dispatch resize if size changed
					this.#rowSizeSet(rowNum, size);
				});
				this.#reflow();
			}
		}

		/*panelsResizeSmooth(areas, callback) {
			let duration = 200;
			let firstStates = Array.from(this.panel.areas);
			let startTime = null;
			let step = (timestamp) => {
				if (!startTime) startTime = timestamp;
				let progress = timestamp - startTime;
				for (let i = 0; i < this.panel.areas.length; i++) {
					this.panel.areas[i] = firstStates[i] + (areas[i] - firstStates[i]) / duration * progress;
				}
				this.panelGridSet();

				if (progress < duration) {
					setTimeout(() => {
						step(+new Date());
					}, 5);
				} else {
					if (callback) {
						callback();
					}
				}
			};
			step(+new Date());
		}*/
	}

	customElements.define('x-panels', Panels);

	const rules$g = [{"selector":"x-draggable x-draggable-item, .x-draggable-phantom ","rule":"display: inline-block;box-sizing: border-box;cursor: default;user-select: none;vertical-align: top;"},{"selector":"x-draggable x-draggable-item ","rule":""},{"selector":".x-draggable-phantom ","rule":"pointer-events: none;position: fixed;z-index: 1000000;"},{"selector":".x-draggable-spacer ","rule":"vertical-align: top;"},{"selector":"x-draggable[orientation='horizontal'] .x-draggable-spacer ","rule":"display: inline-block;"},{"selector":"x-draggable[orientation='verticalLeft'] .x-draggable-spacer, x-draggable[orientation='verticalRight'] .x-draggable-spacer ","rule":"display: block;"},{"selector":"x-draggable[orientation='horizontal'] x-draggable-item, .x-draggable-phantom-horizontal ","rule":""},{"selector":"x-draggable[orientation='verticalLeft'] x-draggable-item, .x-draggable-phantom-verticalLeft,x-draggable[orientation='verticalRight'] x-draggable-item, .x-draggable-phantom-verticalRight ","rule":"writing-mode: vertical-rl;white-space: nowrap;"},{"selector":".x-draggable-phantom-horizontal ","rule":"padding: 3px 10px;"},{"selector":".x-draggable-phantom-verticalLeft, .x-draggable-phantom-verticalRight ","rule":"padding: 10px 3px;"},{"selector":"x-draggable[orientation='verticalLeft'] x-draggable-item, .x-draggable-phantom-verticalLeft ","rule":"transform: rotate(180deg);"}];
				let cssStyle$g;
				const css$g = {
					install:() => {
						cssStyle$g = document.createElement("style");
						document.head.appendChild(cssStyle$g);
						const cssStyleSheet = cssStyle$g.sheet;
						rules$g.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/ui/draggable/draggable.css]:', rules);
					},
					remove:() => {
						if (cssStyle$g) {document.head.removeChild(cssStyle$g);}
					}
				};

	css$g.install();

	let Draggable = (() => {
		let containersByGroup = {};

		return class extends HTMLElement {
			orientation;
			name;
			group;											//pointer to containersByGroup[this.name]
			#groupName;

			constructor(cfg) {
				super();
				if (cfg) {
					this.orientation = cfg.orientation;		//horizontal, verticalLeft, verticalRight
					this.setAttribute('orientation', cfg.orientation);
					this.#groupName = cfg.group;
					this.setAttribute('group', cfg.group);
					this.name = cfg.name;
					this.setAttribute('name', cfg.name);
				}
			}

			connectedCallback() {
				this.orientation = this.getAttribute('orientation');		//horizontal, verticalLeft, verticalRight
				if (!this.#groupName) {
					this.#groupName = this.getAttribute('group');
				}
				this.name = this.getAttribute('name');
				if (!containersByGroup[this.#groupName]) {
					this.group = containersByGroup[this.#groupName] = [];
				} else {
					this.group = containersByGroup[this.#groupName];
				}
				this.group.push(this);
			}
		};
	})();

	customElements.define('x-draggable', Draggable);


	class DraggableItem extends HTMLElement {
		#drag;
		#$container;

		constructor() {
			super();
			this.#drag = {
				$el: null,
				enabled: false,
				collapsed: false,
				originSize: null,					//total size: margin + border + padding + width
				originMarginLeft: null,				//marginLeft
				originMarginTop: null,				//marginTop
				offsetX: null,						//top left (X,Y) of dragged element
				offsetY: null,						//
				orientation: null					//orientation of element
			};

			this.addEventListener('mousedragstart', () => {
				let viewport = this.getBoundingClientRect();
				this.#drag.offsetX = viewport.left;
				this.#drag.offsetY = viewport.top;
			}, true);

			this.addEventListener('mousedrag', (e) => {
				if (!this.#drag.enabled && (Math.abs(e.detail.offsetX) > 5 || Math.abs(e.detail.offsetY) > 5)) {
					this.#drag.enabled = true;
					this.#drag.orientation = this.#$container.orientation;
					this.#drag.$el = document.createElement('div');
					this.#drag.$el.appendChild(this.childNodes[0].cloneNode(true));
					this.#drag.$el.style.left = (this.#drag.offsetX + e.detail.offsetX) + 'px';
					this.#drag.$el.style.top = (this.#drag.offsetY + e.detail.offsetY) + 'px';
					this.#drag.$el.classList.add('x-draggable-phantom');
					this.#drag.$el.classList.add('x-draggable-phantom-' + this.#drag.orientation);
					document.body.appendChild(this.#drag.$el);

					if (this.#drag.orientation === 'horizontal') {			//horizontal
						this.#drag.sizeProperty = 'width';
						this.#drag.originSize = cumulativeWidth(this);
					} else {												//vertical
						this.#drag.sizeProperty = 'height';
						this.#drag.originSize = cumulativeHeight(this);
					}
					let cs = window.getComputedStyle(this, null);
					this.#drag.originMarginLeft = Number.parseInt(cs.marginLeft);
					this.#drag.originMarginTop = Number.parseInt(cs.marginTop);
					this.#drag.$spacer = this.#spacerCreate(this.#drag.sizeProperty, this.#drag.originSize);
					this.parentNode.insertBefore(this.#drag.$spacer, this);
					this.parentNode.removeChild(this);
					this.dispatchEvent(
						new CustomEvent('dragstart', {})
					);
				}

				if (this.#drag.enabled) {
					let pos = {
						left: (this.#drag.offsetX + e.detail.offsetX),
						top: (this.#drag.offsetY + e.detail.offsetY)
					};
					this.#drag.$el.style.left = pos.left + 'px';
					this.#drag.$el.style.top = pos.top + 'px';

					let $newContainer = null;
					this.#$container.group.forEach($container => {
						if (isIntersecting(this.#drag.$el, $container)) {
							$newContainer = $container;
							return false;
						}
					});

					if ($newContainer) {
						//console.log('$newContainer:', $newContainer);
						if (!$newContainer.childNodes.length) {
							let $spacer = this.#spacerCreate('width', this.#drag.originSize);
							$newContainer.appendChild($spacer);
						} else {																						//$newContainer.orientation === 'verticalLeft' or 'verticalRight'
							let baseOrientation = $newContainer.orientation === 'horizontal' ? 'h' : 'v';
							let propsCfg = {
								h: {
									pos: 'left',
									axis: 'x',
									size: 'width',
									clientSize: 'clientWidth',
									cumulativeSize: cumulativeWidth
								},
								v: {
									pos: 'top',
									axis: 'y',
									size: 'height',
									clientSize: 'clientHeight',
									cumulativeSize: cumulativeHeight
								}
							}[baseOrientation];
							let middlePoint = pos[propsCfg.pos] + this.#drag.$el[propsCfg.clientSize] / 2;
							$newContainer.childNodes.forEach(($node) => {
								if ($node.tagName === 'X-DRAGGABLE-ITEM' && $node !== this) {
									let nodeViewPort = $node.getBoundingClientRect();
									let nodeSize = propsCfg.cumulativeSize($node);
									if (middlePoint >= nodeViewPort[propsCfg.axis] && middlePoint <= nodeViewPort[propsCfg.axis] + nodeSize) {
										if (middlePoint < nodeViewPort[propsCfg.axis] + nodeSize / 2) {
											let $prev = $node.previousSibling;
											if (!$prev || ($prev && $prev.tagName === 'X-DRAGGABLE-ITEM')) {
												let $spacer = this.#spacerCreate(propsCfg.size, 0);
												$node.parentNode.insertBefore($spacer, $node);
												animateProperty($spacer, $spacer.property, this.#drag.originSize);
											}
										} else {
											let $next = $node.nextSibling;
											if (!$next || ($next && $next.tagName === 'X-DRAGGABLE-ITEM')) {
												let $spacer = this.#spacerCreate(propsCfg.size, 0);
												insertAfter($node.parentNode, $spacer, $node);
												animateProperty($spacer, $spacer.property, this.#drag.originSize);
											}
										}
										return false;
									} else if ($node === $newContainer.lastChild && pos[propsCfg.pos] > nodeViewPort[propsCfg.axis] + nodeSize) {
										let $spacer = this.#spacerCreate(propsCfg.size, this.#drag.originSize);
										$newContainer.appendChild($spacer);
									}
								}
							});
						}
					} else if (this.#drag.$spacer) {
						this.#spacerRemove();
					}
				}
			}, true);

			this.addEventListener('mousedragstop', () => {
				if (this.#drag.enabled) {
					this.#drag.enabled = false;
					if (!this.#drag.$spacer) {
						this.#drag.$spacer = this.#spacerCreate();
						this.#$container.appendChild(this.#drag.$spacer);
					}

					let $newContainer = this.#drag.$spacer.parentNode;

					let spacerViewPort = this.#drag.$spacer.getBoundingClientRect();
					animateProperty(this.#drag.$el, 'left', spacerViewPort.x + this.#drag.originMarginLeft);
					animateProperty(this.#drag.$el, 'top', spacerViewPort.y + this.#drag.originMarginTop, ($el) => {
						$newContainer.insertBefore(this, this.#drag.$spacer);
						$el.parentNode.removeChild($el);
						$newContainer.removeChild(this.#drag.$spacer);
					});

					this.dispatchEvent(
						new CustomEvent('dragstop',
							{
								detail: {
									$oldContainer: this.#$container,
									$newContainer: $newContainer
								}
							}
						)
					);
				}
			}, true);
		}

		connectedCallback() {
			this.#$container = this.parentNode;
		}

		#spacerCreate(property, value) {
			this.#spacerRemove();
			let $spacer = this.#drag.$spacer = document.createElement('div');
			$spacer.className = 'x-draggable-spacer';
			if (property) {
				$spacer.property = property;
				$spacer.style[property] = value + 'px';
			}
			return $spacer;
		}

		#spacerRemove() {
			if (this.#drag.$spacer) {
				let $spacer = this.#drag.$spacer;
				this.#drag.$spacer = null;
				animateProperty($spacer, $spacer.property, 0, ($spacer) => {
					$spacer.parentNode.removeChild($spacer);
				});
			}
		}
	}

	customElements.define('x-draggable-item', DraggableItem);

	css$j.install();

	class PanelSpace extends HTMLElement {
		$workspace;
		#config;
		#barContainers;
		#barContentContainers;
		#barStates;
		#panelContents;
		#panelItems;
		#$panels;

		constructor() {
			super();

			this.#barContainers = {};
			this.#barContentContainers = {};
			this.#barStates = {
				left: null,
				right: null,
				top: null,
				bottom: null
			};
			this.#panelContents = {};
			this.#panelItems = {};
		}

		/**
		 * @param config
		 * @param config.barSize					{Object}
		 * @param config.panels						{Object}
		 * @param config.panelContent				{Object}
		 */
		init(config) {
			this.#config = config;
			//console.log('this.#config.barSize.bottom:', this.#config.barSize.bottom);

			Object.entries(this.#config.panelContentConstructors).forEach(([name, panelConstructor]) => {
				if (panelConstructor.init) {
					panelConstructor.init();
				}
			});

			this.#$panels = new Panels();
			this.appendChild(this.#$panels);
			let areaCfg = [
				[
					{top: {height: '19px', repeat: 5}}
				],
				[
					{left: {width: '19px'}},
					{topContent: {height: this.#config.barSize.top + 'px', resizable: 'bottom', repeat: 3}},
					{right: {width: '19px'}}
				],
				[
					{left: {}},
					{leftContent: {width: this.#config.barSize.left + 'px', resizable: 'right'}},
					{workSpace: {width: 'auto', height: 'auto'}},
					{rightContent: {width: this.#config.barSize.right + 'px', resizable: 'left'}},
					{right: {}}
				],
				[
					{left: {}},
					{bottomContent: {height: this.#config.barSize.bottom + 'px', resizable: 'top', repeat: 3}},
					{right: {}}
				],
				[
					{bottom: {height: '19px', repeat: 5}}
				]
			];
			this.#$panels.init(areaCfg);
			this.$workspace = this.#$panels.panels.workSpace;

			Object.entries({
				horizontal: ['top', 'bottom'],
				verticalLeft: ['left'],
				verticalRight: ['right']
			}).forEach(([orientation, barNames]) => {
				barNames.forEach(barName => {
					let $container = new Draggable({group: 'ide', name: barName, orientation: orientation});
					this.#barContainers[barName] = $container;
					this.#barContentContainers[barName] = this.#$panels.panels[barName + 'Content'];
					this.#$panels.panels[barName].appendChild($container);
				});
			});

			Object.entries(this.#config.panels).forEach(([panelName, panelCfg]) => {
				let $panelItem = this.#panelItems[panelName] = new DraggableItem({name: panelName});
				let $panelTile = new PanelSpaceTile();
				$panelTile.configure(this, {
					title: panelCfg.title
				});
				$panelItem.appendChild($panelTile);
				this.#barContainers[panelCfg.bar].appendChild($panelItem);

				if (this.#barContainers[panelCfg.bar].childNodes.length === 0) {
					this.#barContainers[panelCfg.bar].style.display = 'block';
				}
				$panelItem.addEventListener('dragstart', () => {
					Object.values(this.#barContainers).forEach($container => {
						this.#$panels.panels[$container.name].show();
					});
				});
				$panelItem.addEventListener('dragstop', (e) => {
					if (e.detail.$oldContainer.name !== e.detail.$newContainer.name) {
						if (this.#barStates[e.detail.$oldContainer.name] === panelName) {
							this.#barStates[e.detail.$newContainer.name] = panelName;
							this.#barStates[e.detail.$oldContainer.name] = null;
						}
						panelCfg.bar = e.detail.$newContainer.name;
					}
					this.#panelContentsReflow();
				});
				$panelItem.addEventListener('click', () => {
					if (this.#barStates[panelCfg.bar] === panelName) {
						this.#barStates[panelCfg.bar] = null;
					} else {
						this.#barStates[panelCfg.bar] = panelName;
					}
					this.#panelContentsReflow();
				});

				if (panelCfg.isOpen) {
					this.#barStates[panelCfg.bar] = panelName;
				}
			});
			this.#panelContentsReflow();
		}

		barsShow(value) {
			Object.values(this.#barContainers).forEach($container => {
				if (value && this.#barContainers[$container.name].childNodes.length) {
					this.#$panels.panels[$container.name].show();
				} else {
					this.#$panels.panels[$container.name].hide();
				}
			});
		}

		panelSelect(panelName) {
			//console.log('[panelspace] panelSelect:', panelName);
			this.#barStates[this.#config.panels[panelName].bar] = panelName;
			this.#panelContentsReflow();
		}

		panelCollapse(panelName) {
			if (this.#barStates[this.#config.panels[panelName].bar] === panelName) {
				this.#barStates[this.#config.panels[panelName].bar] = null;
			}
			this.#panelContentsReflow();
		}

		#panelContentsReflow() {
			//console.log('[panelspace] #panelContentsReflow');
			Object.values(this.#barContainers).forEach($container => {
				if (!$container.childNodes.length) {
					this.#barContainers[$container.name].parentNode.hide();								//Grid Panel
					this.#barContentContainers[$container.name].hide();
				}
			});

			Object.entries(this.#barStates).forEach(([barName, panelName]) => {
				let $contentContainer = this.#barContentContainers[barName];
				this.#barContainers[barName].childNodes.forEach($panelItem => {
					$panelItem.classList.remove('active');
				});
				if (!panelName) {
					if ($contentContainer.childNodes[1]) {
						$contentContainer.removeChild($contentContainer.childNodes[1]);
					}
					$contentContainer.hide();
				} else {
					this.#panelItems[panelName].classList.add('active');
					let $content = this.#panelContents[panelName];
					if (!$content) {
						//console.log('this.#config.panelContentConstructors:', this.#config.panelContentConstructors, panelName);
						$content = this.#panelContents[panelName] = new this.#config.panelContentConstructors[panelName]({
							panelCollapse: this.panelCollapse.bind(this, panelName)
						});
					} else if ($content.reflow) {
						$content.reflow();
					}
					let $oldContent = $contentContainer.childNodes[0];
					if ($oldContent && $oldContent !== $content) {
						$contentContainer.removeChild($oldContent);
					}
					this.#barContentContainers[barName].appendChild($content);
					$contentContainer.show();
				}
			});
		}
	}

	customElements.define('x-panelspace', PanelSpace);

	class PanelSpaceTile extends HTMLElement {
		configure(ide, cfg) {
			this.innerHTML = cfg.title;
		}
	}

	customElements.define('x-panelspace-paneltile', PanelSpaceTile);

	let Tpl_projectInfo = class extends RP {
						constructor(model, logic) {
							const tree = {"vDom":{"tree":[{"type":"tag","tagName":"div","attrs":{"class":{"value":"menu","type":"string"}},"childNodes":[{"type":"tag","tagName":"item","attrs":{"name":{"value":"build","type":"string"}},"childNodes":[{"type":"tag","tagName":"i","attrs":{"class":{"value":"ico hammer actionHover","type":"string"}},"childNodes":[]},{"type":"tag","tagName":"span","attrs":{"class":{"value":"actionHover","type":"string"},"onclick":{"type":"event","fn":"self.build();"}},"childNodes":[{"type":"textNode","value":"Build"}]}]}]},{"type":"component","tagName":"x-tree","attrs":{"value":{"valueOutRender":"m.tree","modelDepends":[{"refName":"m","modelPath":"tree","valueOutRender":"m.tree","jsonInnerPath":""}],"modelOut":[{"refName":"m","modelPath":"tree"}],"type":"json"},"selected":{"valueOutRender":"m.selectedFile","modelDepends":[{"refName":"m","modelPath":"selectedFile","valueOutRender":"m.selectedFile","jsonInnerPath":""}],"modelOut":[{"refName":"m","modelPath":"selectedFile"}],"type":"json"}},"childNodes":[]}]}};
							super(tree, model, logic);
						}
					};
					customElements.define('x-tpl_projectinfo', Tpl_projectInfo);
				
					let Tpl_noProject = class extends RP {
						constructor(model, logic) {
							const tree = {"vDom":{"tree":[{"type":"tag","tagName":"div","attrs":{"class":{"value":"menu","type":"string"}},"childNodes":[{"type":"tag","tagName":"item","attrs":{"name":{"value":"build","type":"string"}},"childNodes":[{"type":"tag","tagName":"i","attrs":{"class":{"value":"ico white createNew","type":"string"}},"childNodes":[]},{"type":"tag","tagName":"span","attrs":{"class":{"value":"blueHover","type":"string"},"onclick":{"type":"event","fn":"self.create();"}},"childNodes":[{"type":"textNode","value":"Create"}]}]},{"type":"tag","tagName":"item","attrs":{"name":{"value":"build","type":"string"}},"childNodes":[{"type":"tag","tagName":"i","attrs":{"class":{"value":"ico white run","type":"string"}},"childNodes":[]},{"type":"tag","tagName":"span","attrs":{"class":{"value":"blueHover","type":"string"},"onclick":{"type":"event","fn":"self.open();"}},"childNodes":[{"type":"textNode","value":"Open"}]}]}]}]}};
							super(tree, model, logic);
						}
					};
					customElements.define('x-tpl_noproject', Tpl_noProject);

	const rules$f = [{"selector":"x-tpl_projectinfo ","rule":"display: block;"},{"selector":"x-tpl_projectinfo .menu item * ","rule":"cursor: default;"},{"selector":"x-tpl_projectinfo > * ","rule":"display: flex;flex-direction: column;height: 100%;"},{"selector":"x-tpl_projectinfo > x-tree ","rule":"margin-top: 10px;box-sizing: border-box;"}];
				let cssStyle$f;
				const css$f = {
					install:() => {
						cssStyle$f = document.createElement("style");
						document.head.appendChild(cssStyle$f);
						const cssStyleSheet = cssStyle$f.sheet;
						rules$f.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/panels/projectInfo/projectInfo.css]:', rules);
					},
					remove:() => {
						if (cssStyle$f) {document.head.removeChild(cssStyle$f);}
					}
				};

	const rules$e = [{"selector":"x-tpl_tree_item .item ","rule":"display: block;padding-top: 3px;padding-bottom: 3px;-webkit-user-select: none; -ms-user-select: none; user-select: none;white-space: nowrap;"},{"selector":"x-tpl_tree_item .item.selected ","rule":"background: var(--element-selected-bg-color);color: var(--element-selected-text-color);"},{"selector":"x-tpl_tree_item .item > * ","rule":"display: inline-block;vertical-align: middle;cursor: default;"},{"selector":"x-tpl_tree_item .item > span > * ","rule":"vertical-align: middle;"},{"selector":"x-tpl_tree_item .item > span > span ","rule":"vertical-align: middle;margin-left: 5px;"}];
				let cssStyle$e;
				const css$e = {
					install:() => {
						cssStyle$e = document.createElement("style");
						document.head.appendChild(cssStyle$e);
						const cssStyleSheet = cssStyle$e.sheet;
						rules$e.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/ui/tree/tree.css]:', rules);
					},
					remove:() => {
						if (cssStyle$e) {document.head.removeChild(cssStyle$e);}
					}
				};

	let Tpl_tree_item = class extends RP {
						constructor(model, logic) {
							const tree = {"vDom":{"tree":[{"type":"tag","tagName":"div","attrs":{"class":{"value":"item","type":"string"},"name":{"value":"item","type":"string"},"onclick":{"type":"event","fn":"self.select();"},"oncontextmenu":{"type":"event","fn":"self.onContextMenu(); return false;"},"ondblclick":{"type":"event","fn":"self.onDoubleClick();"}},"childNodes":[{"type":"tag","tagName":"i","attrs":{"class":{"type":"string","valueInRender":null,"valueOutRender":"'ico '+(m.isExpanded ? 'directDown' : 'directRight')","modelOut":[{"refName":"m","modelPath":"isExpanded"}],"modelDepends":[{"refName":"m","modelPath":"isExpanded","canSync":false}]},"onclick":{"type":"event","fn":"self.roll(); e.stopPropagation();"},"style":{"type":"string","valueInRender":null,"valueOutRender":"'visibility: '+(m.isDirectory && m.childNodes.length ? 'visible' : 'hidden')","modelOut":[{"refName":"m","modelPath":"isDirectory"},{"refName":"m","modelPath":"childNodes.length"}],"modelDepends":[{"refName":"m","modelPath":"isDirectory","canSync":false},{"refName":"m","modelPath":"childNodes.length","canSync":false}]}},"childNodes":[]},{"type":"tag","tagName":"span","attrs":{},"childNodes":[{"type":"tag","tagName":"i","attrs":{"class":{"type":"string","valueInRender":null,"valueOutRender":"'icoColor '+(m.ico)","modelOut":[{"refName":"m","modelPath":"ico"}],"modelDepends":[{"refName":"m","modelPath":"ico","canSync":false}]}},"childNodes":[]},{"type":"tag","tagName":"span","attrs":{"class":{"value":"title","type":"string"}},"childNodes":[{"type":"splitNode"},{"type":"textNode","value":"","placeNum":10,"valueInRender":null,"valueOutRender":"m.title","modelDepends":[{"refName":"m","modelPath":"title","canSync":true}]},{"type":"splitNode"}]}]}]},{"type":"tag","tagName":"div","attrs":{"name":{"value":"children","type":"string"}},"childNodes":[]}]}};
							super(tree, model, logic);
						}
					};
					customElements.define('x-tpl_tree_item', Tpl_tree_item);

	css$e.install();

	/**
	 *
	 * @class {Tree}
	 * @param cfg		{Object}
	 * @param cfg.value	{Object}	//  [{ico, title, value, color, isVisible: boolean, isExpanded:boolean, childNodes: [...] }]
	 *
	 * @example:
	 * 		<x-tree value:="m.tree" selected:="m.selected"></x-tree>
	 */


	const Tree = class Tree extends HTMLElement {
		#cfg;								// {onDoubleClick, onContextMenu}
		#cache;
		#itemsByPath;
		#selectedNode;
		#isChildrenRendered;				// {path: bool}

		constructor(model) {
			super();
			this.model = model;
			this.#itemsByPath = {};
			this.#cache = {};
			this.#cfg = {};

			//console.log('[tree] model:', model);
			this.model.addEventListener('change', /^value\.(.*)/, cfg => {
				//console.log('[tree] model changed:', cfg);
				this.#selectedNode = undefined;
				this.#isChildrenRendered = {};
				this.#renderList('', this, this.model.data.value, 1);
			});

			this.model.addEventListener('change', /^selected$/, cfg => {
				//console.log('[tree] selected changed:', cfg);
				//console.log('[tree] this.#itemsByPath', this.#itemsByPath);
				if (this.#selectedNode) {
					this.#selectedNode.classList.remove('selected');
				}
				if (cfg.newValue) {
					this.#selectedNode = this.#itemsByPath[cfg.newValue].querySelector('[name=item]');
					this.#selectedNode.classList.add('selected');
				}
			});

			this.#isChildrenRendered = {};
			this.reflow();
		}

		configure(cfg) {
			this.#cfg = cfg;
		}

		reflow() {
			this.#selectedNode = undefined;
			this.model.data.selected = undefined;
			this.#renderList('', this, this.model.data.value, 1);
		}

		#renderList(parentPath, $container, data, level) {
			childNodesRemove($container);
			this.#isChildrenRendered[parentPath] = true;

			Array.from(data).sort((a, b) => a.title > b.title ? 1 : -1).forEach(item => {
				const itemPath = parentPath ? `${parentPath}/${item.value ? item.value : item.title}` : (item.value ? item.value : item.title);
				let $childrenContainer, $itemContainer;

				const logic = {
					roll: () => {
						if (item.childNodes.length) {
							$item.model.data.isExpanded = !$item.model.data.isExpanded;
							$childrenContainer.style.display = $item.model.data.isExpanded ? 'block' : 'none';
							if (!this.#isChildrenRendered[itemPath]) {
								this.#renderList(itemPath, $childrenContainer, item.childNodes, level + 1);
							}
						}
					},
					select: () => {
						this.model.data.selected = itemPath;
					},
					onContextMenu: () => {
						logic.select();
						if (item.onContextMenu) {
							item.onContextMenu(itemPath);
						} else if (this.#cfg.onContextMenu) {
							this.#cfg.onContextMenu(itemPath);
						}
					},
					onDoubleClick: () => {
						if (item.isDirectory && item.childNodes.length) {
							logic.roll();
						} else if (this.#cfg.onDoubleClick) {
							this.#cfg.onDoubleClick(itemPath);
						}
					}
				};
				const $item = this.#itemsByPath[itemPath] = new Tpl_tree_item(item, logic);
				$childrenContainer = $item.querySelector('[name=children]');
				$itemContainer = $item.querySelector('[name=item]');
				$itemContainer.style['padding-left'] = level * 10 + "px";
				if (item.hint) {
					if (typeof item.hint === 'function') {
						let $hint = item.hint();
						if ($hint) {
							$hint.classList.add('hint');
							$itemContainer.appendChild($hint);
						}
					}
				}

				if (item.isDirectory) {
					const fullPath = parentPath ? `${parentPath}/${item.value ? item.value : item.title}` : (item.value ? item.value : item.title);
					const modelPath = 'value' + fullPath.split('/').reduce((cfg, name) => {
						const nodeId = cfg.children.findIndex(child => child[child.value ? 'value' : 'title'] === name);
						cfg.nodeNames.push(nodeId);
						return {
							nodeNames: cfg.nodeNames,
							children: cfg.children[nodeId].childNodes
						}
					}, {children: this.model.data.value, nodeNames: []})
						.nodeNames
						.map(item => '.' + item)
						.join('.childNodes') + ".isExpanded";
					$item.model.bridgeChanges('isExpanded', this.model, modelPath);
				}

				$container.appendChild($item);
				if (item.isExpanded && item.childNodes.length) {
					this.#renderList(itemPath, $childrenContainer, item.childNodes, level + 1);
				}
			});
		}
	};

	customElements.define('x-tree', Tree);

	var commonjsGlobal = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};

	function commonjsRequire (path) {
		throw new Error('Could not dynamically require "' + path + '". Please configure the dynamicRequireTargets or/and ignoreDynamicRequires option of @rollup/plugin-commonjs appropriately for this require call to work.');
	}

	var jszip_min = {exports: {}};

	/*!

	JSZip v3.10.1 - A JavaScript class for generating and reading zip files
	<http://stuartk.com/jszip>

	(c) 2009-2016 Stuart Knightley <stuart [at] stuartk.com>
	Dual licenced under the MIT license or GPLv3. See https://raw.github.com/Stuk/jszip/main/LICENSE.markdown.

	JSZip uses the library pako released under the MIT license :
	https://github.com/nodeca/pako/blob/main/LICENSE
	*/

	(function (module, exports) {
	!function(e){module.exports=e();}(function(){return function s(a,o,h){function u(r,e){if(!o[r]){if(!a[r]){var t="function"==typeof commonjsRequire&&commonjsRequire;if(!e&&t)return t(r,!0);if(l)return l(r,!0);var n=new Error("Cannot find module '"+r+"'");throw n.code="MODULE_NOT_FOUND",n}var i=o[r]={exports:{}};a[r][0].call(i.exports,function(e){var t=a[r][1][e];return u(t||e)},i,i.exports,s,a,o,h);}return o[r].exports}for(var l="function"==typeof commonjsRequire&&commonjsRequire,e=0;e<h.length;e++)u(h[e]);return u}({1:[function(e,t,r){var d=e("./utils"),c=e("./support"),p="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";r.encode=function(e){for(var t,r,n,i,s,a,o,h=[],u=0,l=e.length,f=l,c="string"!==d.getTypeOf(e);u<e.length;)f=l-u,n=c?(t=e[u++],r=u<l?e[u++]:0,u<l?e[u++]:0):(t=e.charCodeAt(u++),r=u<l?e.charCodeAt(u++):0,u<l?e.charCodeAt(u++):0),i=t>>2,s=(3&t)<<4|r>>4,a=1<f?(15&r)<<2|n>>6:64,o=2<f?63&n:64,h.push(p.charAt(i)+p.charAt(s)+p.charAt(a)+p.charAt(o));return h.join("")},r.decode=function(e){var t,r,n,i,s,a,o=0,h=0,u="data:";if(e.substr(0,u.length)===u)throw new Error("Invalid base64 input, it looks like a data url.");var l,f=3*(e=e.replace(/[^A-Za-z0-9+/=]/g,"")).length/4;if(e.charAt(e.length-1)===p.charAt(64)&&f--,e.charAt(e.length-2)===p.charAt(64)&&f--,f%1!=0)throw new Error("Invalid base64 input, bad content length.");for(l=c.uint8array?new Uint8Array(0|f):new Array(0|f);o<e.length;)t=p.indexOf(e.charAt(o++))<<2|(i=p.indexOf(e.charAt(o++)))>>4,r=(15&i)<<4|(s=p.indexOf(e.charAt(o++)))>>2,n=(3&s)<<6|(a=p.indexOf(e.charAt(o++))),l[h++]=t,64!==s&&(l[h++]=r),64!==a&&(l[h++]=n);return l};},{"./support":30,"./utils":32}],2:[function(e,t,r){var n=e("./external"),i=e("./stream/DataWorker"),s=e("./stream/Crc32Probe"),a=e("./stream/DataLengthProbe");function o(e,t,r,n,i){this.compressedSize=e,this.uncompressedSize=t,this.crc32=r,this.compression=n,this.compressedContent=i;}o.prototype={getContentWorker:function(){var e=new i(n.Promise.resolve(this.compressedContent)).pipe(this.compression.uncompressWorker()).pipe(new a("data_length")),t=this;return e.on("end",function(){if(this.streamInfo.data_length!==t.uncompressedSize)throw new Error("Bug : uncompressed data size mismatch")}),e},getCompressedWorker:function(){return new i(n.Promise.resolve(this.compressedContent)).withStreamInfo("compressedSize",this.compressedSize).withStreamInfo("uncompressedSize",this.uncompressedSize).withStreamInfo("crc32",this.crc32).withStreamInfo("compression",this.compression)}},o.createWorkerFrom=function(e,t,r){return e.pipe(new s).pipe(new a("uncompressedSize")).pipe(t.compressWorker(r)).pipe(new a("compressedSize")).withStreamInfo("compression",t)},t.exports=o;},{"./external":6,"./stream/Crc32Probe":25,"./stream/DataLengthProbe":26,"./stream/DataWorker":27}],3:[function(e,t,r){var n=e("./stream/GenericWorker");r.STORE={magic:"\0\0",compressWorker:function(){return new n("STORE compression")},uncompressWorker:function(){return new n("STORE decompression")}},r.DEFLATE=e("./flate");},{"./flate":7,"./stream/GenericWorker":28}],4:[function(e,t,r){var n=e("./utils");var o=function(){for(var e,t=[],r=0;r<256;r++){e=r;for(var n=0;n<8;n++)e=1&e?3988292384^e>>>1:e>>>1;t[r]=e;}return t}();t.exports=function(e,t){return void 0!==e&&e.length?"string"!==n.getTypeOf(e)?function(e,t,r,n){var i=o,s=n+r;e^=-1;for(var a=n;a<s;a++)e=e>>>8^i[255&(e^t[a])];return -1^e}(0|t,e,e.length,0):function(e,t,r,n){var i=o,s=n+r;e^=-1;for(var a=n;a<s;a++)e=e>>>8^i[255&(e^t.charCodeAt(a))];return -1^e}(0|t,e,e.length,0):0};},{"./utils":32}],5:[function(e,t,r){r.base64=!1,r.binary=!1,r.dir=!1,r.createFolders=!0,r.date=null,r.compression=null,r.compressionOptions=null,r.comment=null,r.unixPermissions=null,r.dosPermissions=null;},{}],6:[function(e,t,r){var n=null;n="undefined"!=typeof Promise?Promise:e("lie"),t.exports={Promise:n};},{lie:37}],7:[function(e,t,r){var n="undefined"!=typeof Uint8Array&&"undefined"!=typeof Uint16Array&&"undefined"!=typeof Uint32Array,i=e("pako"),s=e("./utils"),a=e("./stream/GenericWorker"),o=n?"uint8array":"array";function h(e,t){a.call(this,"FlateWorker/"+e),this._pako=null,this._pakoAction=e,this._pakoOptions=t,this.meta={};}r.magic="\b\0",s.inherits(h,a),h.prototype.processChunk=function(e){this.meta=e.meta,null===this._pako&&this._createPako(),this._pako.push(s.transformTo(o,e.data),!1);},h.prototype.flush=function(){a.prototype.flush.call(this),null===this._pako&&this._createPako(),this._pako.push([],!0);},h.prototype.cleanUp=function(){a.prototype.cleanUp.call(this),this._pako=null;},h.prototype._createPako=function(){this._pako=new i[this._pakoAction]({raw:!0,level:this._pakoOptions.level||-1});var t=this;this._pako.onData=function(e){t.push({data:e,meta:t.meta});};},r.compressWorker=function(e){return new h("Deflate",e)},r.uncompressWorker=function(){return new h("Inflate",{})};},{"./stream/GenericWorker":28,"./utils":32,pako:38}],8:[function(e,t,r){function A(e,t){var r,n="";for(r=0;r<t;r++)n+=String.fromCharCode(255&e),e>>>=8;return n}function n(e,t,r,n,i,s){var a,o,h=e.file,u=e.compression,l=s!==O.utf8encode,f=I.transformTo("string",s(h.name)),c=I.transformTo("string",O.utf8encode(h.name)),d=h.comment,p=I.transformTo("string",s(d)),m=I.transformTo("string",O.utf8encode(d)),_=c.length!==h.name.length,g=m.length!==d.length,b="",v="",y="",w=h.dir,k=h.date,x={crc32:0,compressedSize:0,uncompressedSize:0};t&&!r||(x.crc32=e.crc32,x.compressedSize=e.compressedSize,x.uncompressedSize=e.uncompressedSize);var S=0;t&&(S|=8),l||!_&&!g||(S|=2048);var z=0,C=0;w&&(z|=16),"UNIX"===i?(C=798,z|=function(e,t){var r=e;return e||(r=t?16893:33204),(65535&r)<<16}(h.unixPermissions,w)):(C=20,z|=function(e){return 63&(e||0)}(h.dosPermissions)),a=k.getUTCHours(),a<<=6,a|=k.getUTCMinutes(),a<<=5,a|=k.getUTCSeconds()/2,o=k.getUTCFullYear()-1980,o<<=4,o|=k.getUTCMonth()+1,o<<=5,o|=k.getUTCDate(),_&&(v=A(1,1)+A(B(f),4)+c,b+="up"+A(v.length,2)+v),g&&(y=A(1,1)+A(B(p),4)+m,b+="uc"+A(y.length,2)+y);var E="";return E+="\n\0",E+=A(S,2),E+=u.magic,E+=A(a,2),E+=A(o,2),E+=A(x.crc32,4),E+=A(x.compressedSize,4),E+=A(x.uncompressedSize,4),E+=A(f.length,2),E+=A(b.length,2),{fileRecord:R.LOCAL_FILE_HEADER+E+f+b,dirRecord:R.CENTRAL_FILE_HEADER+A(C,2)+E+A(p.length,2)+"\0\0\0\0"+A(z,4)+A(n,4)+f+b+p}}var I=e("../utils"),i=e("../stream/GenericWorker"),O=e("../utf8"),B=e("../crc32"),R=e("../signature");function s(e,t,r,n){i.call(this,"ZipFileWorker"),this.bytesWritten=0,this.zipComment=t,this.zipPlatform=r,this.encodeFileName=n,this.streamFiles=e,this.accumulate=!1,this.contentBuffer=[],this.dirRecords=[],this.currentSourceOffset=0,this.entriesCount=0,this.currentFile=null,this._sources=[];}I.inherits(s,i),s.prototype.push=function(e){var t=e.meta.percent||0,r=this.entriesCount,n=this._sources.length;this.accumulate?this.contentBuffer.push(e):(this.bytesWritten+=e.data.length,i.prototype.push.call(this,{data:e.data,meta:{currentFile:this.currentFile,percent:r?(t+100*(r-n-1))/r:100}}));},s.prototype.openedSource=function(e){this.currentSourceOffset=this.bytesWritten,this.currentFile=e.file.name;var t=this.streamFiles&&!e.file.dir;if(t){var r=n(e,t,!1,this.currentSourceOffset,this.zipPlatform,this.encodeFileName);this.push({data:r.fileRecord,meta:{percent:0}});}else this.accumulate=!0;},s.prototype.closedSource=function(e){this.accumulate=!1;var t=this.streamFiles&&!e.file.dir,r=n(e,t,!0,this.currentSourceOffset,this.zipPlatform,this.encodeFileName);if(this.dirRecords.push(r.dirRecord),t)this.push({data:function(e){return R.DATA_DESCRIPTOR+A(e.crc32,4)+A(e.compressedSize,4)+A(e.uncompressedSize,4)}(e),meta:{percent:100}});else for(this.push({data:r.fileRecord,meta:{percent:0}});this.contentBuffer.length;)this.push(this.contentBuffer.shift());this.currentFile=null;},s.prototype.flush=function(){for(var e=this.bytesWritten,t=0;t<this.dirRecords.length;t++)this.push({data:this.dirRecords[t],meta:{percent:100}});var r=this.bytesWritten-e,n=function(e,t,r,n,i){var s=I.transformTo("string",i(n));return R.CENTRAL_DIRECTORY_END+"\0\0\0\0"+A(e,2)+A(e,2)+A(t,4)+A(r,4)+A(s.length,2)+s}(this.dirRecords.length,r,e,this.zipComment,this.encodeFileName);this.push({data:n,meta:{percent:100}});},s.prototype.prepareNextSource=function(){this.previous=this._sources.shift(),this.openedSource(this.previous.streamInfo),this.isPaused?this.previous.pause():this.previous.resume();},s.prototype.registerPrevious=function(e){this._sources.push(e);var t=this;return e.on("data",function(e){t.processChunk(e);}),e.on("end",function(){t.closedSource(t.previous.streamInfo),t._sources.length?t.prepareNextSource():t.end();}),e.on("error",function(e){t.error(e);}),this},s.prototype.resume=function(){return !!i.prototype.resume.call(this)&&(!this.previous&&this._sources.length?(this.prepareNextSource(),!0):this.previous||this._sources.length||this.generatedError?void 0:(this.end(),!0))},s.prototype.error=function(e){var t=this._sources;if(!i.prototype.error.call(this,e))return !1;for(var r=0;r<t.length;r++)try{t[r].error(e);}catch(e){}return !0},s.prototype.lock=function(){i.prototype.lock.call(this);for(var e=this._sources,t=0;t<e.length;t++)e[t].lock();},t.exports=s;},{"../crc32":4,"../signature":23,"../stream/GenericWorker":28,"../utf8":31,"../utils":32}],9:[function(e,t,r){var u=e("../compressions"),n=e("./ZipFileWorker");r.generateWorker=function(e,a,t){var o=new n(a.streamFiles,t,a.platform,a.encodeFileName),h=0;try{e.forEach(function(e,t){h++;var r=function(e,t){var r=e||t,n=u[r];if(!n)throw new Error(r+" is not a valid compression method !");return n}(t.options.compression,a.compression),n=t.options.compressionOptions||a.compressionOptions||{},i=t.dir,s=t.date;t._compressWorker(r,n).withStreamInfo("file",{name:e,dir:i,date:s,comment:t.comment||"",unixPermissions:t.unixPermissions,dosPermissions:t.dosPermissions}).pipe(o);}),o.entriesCount=h;}catch(e){o.error(e);}return o};},{"../compressions":3,"./ZipFileWorker":8}],10:[function(e,t,r){function n(){if(!(this instanceof n))return new n;if(arguments.length)throw new Error("The constructor with parameters has been removed in JSZip 3.0, please check the upgrade guide.");this.files=Object.create(null),this.comment=null,this.root="",this.clone=function(){var e=new n;for(var t in this)"function"!=typeof this[t]&&(e[t]=this[t]);return e};}(n.prototype=e("./object")).loadAsync=e("./load"),n.support=e("./support"),n.defaults=e("./defaults"),n.version="3.10.1",n.loadAsync=function(e,t){return (new n).loadAsync(e,t)},n.external=e("./external"),t.exports=n;},{"./defaults":5,"./external":6,"./load":11,"./object":15,"./support":30}],11:[function(e,t,r){var u=e("./utils"),i=e("./external"),n=e("./utf8"),s=e("./zipEntries"),a=e("./stream/Crc32Probe"),l=e("./nodejsUtils");function f(n){return new i.Promise(function(e,t){var r=n.decompressed.getContentWorker().pipe(new a);r.on("error",function(e){t(e);}).on("end",function(){r.streamInfo.crc32!==n.decompressed.crc32?t(new Error("Corrupted zip : CRC32 mismatch")):e();}).resume();})}t.exports=function(e,o){var h=this;return o=u.extend(o||{},{base64:!1,checkCRC32:!1,optimizedBinaryString:!1,createFolders:!1,decodeFileName:n.utf8decode}),l.isNode&&l.isStream(e)?i.Promise.reject(new Error("JSZip can't accept a stream when loading a zip file.")):u.prepareContent("the loaded zip file",e,!0,o.optimizedBinaryString,o.base64).then(function(e){var t=new s(o);return t.load(e),t}).then(function(e){var t=[i.Promise.resolve(e)],r=e.files;if(o.checkCRC32)for(var n=0;n<r.length;n++)t.push(f(r[n]));return i.Promise.all(t)}).then(function(e){for(var t=e.shift(),r=t.files,n=0;n<r.length;n++){var i=r[n],s=i.fileNameStr,a=u.resolve(i.fileNameStr);h.file(a,i.decompressed,{binary:!0,optimizedBinaryString:!0,date:i.date,dir:i.dir,comment:i.fileCommentStr.length?i.fileCommentStr:null,unixPermissions:i.unixPermissions,dosPermissions:i.dosPermissions,createFolders:o.createFolders}),i.dir||(h.file(a).unsafeOriginalName=s);}return t.zipComment.length&&(h.comment=t.zipComment),h})};},{"./external":6,"./nodejsUtils":14,"./stream/Crc32Probe":25,"./utf8":31,"./utils":32,"./zipEntries":33}],12:[function(e,t,r){var n=e("../utils"),i=e("../stream/GenericWorker");function s(e,t){i.call(this,"Nodejs stream input adapter for "+e),this._upstreamEnded=!1,this._bindStream(t);}n.inherits(s,i),s.prototype._bindStream=function(e){var t=this;(this._stream=e).pause(),e.on("data",function(e){t.push({data:e,meta:{percent:0}});}).on("error",function(e){t.isPaused?this.generatedError=e:t.error(e);}).on("end",function(){t.isPaused?t._upstreamEnded=!0:t.end();});},s.prototype.pause=function(){return !!i.prototype.pause.call(this)&&(this._stream.pause(),!0)},s.prototype.resume=function(){return !!i.prototype.resume.call(this)&&(this._upstreamEnded?this.end():this._stream.resume(),!0)},t.exports=s;},{"../stream/GenericWorker":28,"../utils":32}],13:[function(e,t,r){var i=e("readable-stream").Readable;function n(e,t,r){i.call(this,t),this._helper=e;var n=this;e.on("data",function(e,t){n.push(e)||n._helper.pause(),r&&r(t);}).on("error",function(e){n.emit("error",e);}).on("end",function(){n.push(null);});}e("../utils").inherits(n,i),n.prototype._read=function(){this._helper.resume();},t.exports=n;},{"../utils":32,"readable-stream":16}],14:[function(e,t,r){t.exports={isNode:"undefined"!=typeof Buffer,newBufferFrom:function(e,t){if(Buffer.from&&Buffer.from!==Uint8Array.from)return Buffer.from(e,t);if("number"==typeof e)throw new Error('The "data" argument must not be a number');return new Buffer(e,t)},allocBuffer:function(e){if(Buffer.alloc)return Buffer.alloc(e);var t=new Buffer(e);return t.fill(0),t},isBuffer:function(e){return Buffer.isBuffer(e)},isStream:function(e){return e&&"function"==typeof e.on&&"function"==typeof e.pause&&"function"==typeof e.resume}};},{}],15:[function(e,t,r){function s(e,t,r){var n,i=u.getTypeOf(t),s=u.extend(r||{},f);s.date=s.date||new Date,null!==s.compression&&(s.compression=s.compression.toUpperCase()),"string"==typeof s.unixPermissions&&(s.unixPermissions=parseInt(s.unixPermissions,8)),s.unixPermissions&&16384&s.unixPermissions&&(s.dir=!0),s.dosPermissions&&16&s.dosPermissions&&(s.dir=!0),s.dir&&(e=g(e)),s.createFolders&&(n=_(e))&&b.call(this,n,!0);var a="string"===i&&!1===s.binary&&!1===s.base64;r&&void 0!==r.binary||(s.binary=!a),(t instanceof c&&0===t.uncompressedSize||s.dir||!t||0===t.length)&&(s.base64=!1,s.binary=!0,t="",s.compression="STORE",i="string");var o=null;o=t instanceof c||t instanceof l?t:p.isNode&&p.isStream(t)?new m(e,t):u.prepareContent(e,t,s.binary,s.optimizedBinaryString,s.base64);var h=new d(e,o,s);this.files[e]=h;}var i=e("./utf8"),u=e("./utils"),l=e("./stream/GenericWorker"),a=e("./stream/StreamHelper"),f=e("./defaults"),c=e("./compressedObject"),d=e("./zipObject"),o=e("./generate"),p=e("./nodejsUtils"),m=e("./nodejs/NodejsStreamInputAdapter"),_=function(e){"/"===e.slice(-1)&&(e=e.substring(0,e.length-1));var t=e.lastIndexOf("/");return 0<t?e.substring(0,t):""},g=function(e){return "/"!==e.slice(-1)&&(e+="/"),e},b=function(e,t){return t=void 0!==t?t:f.createFolders,e=g(e),this.files[e]||s.call(this,e,null,{dir:!0,createFolders:t}),this.files[e]};function h(e){return "[object RegExp]"===Object.prototype.toString.call(e)}var n={load:function(){throw new Error("This method has been removed in JSZip 3.0, please check the upgrade guide.")},forEach:function(e){var t,r,n;for(t in this.files)n=this.files[t],(r=t.slice(this.root.length,t.length))&&t.slice(0,this.root.length)===this.root&&e(r,n);},filter:function(r){var n=[];return this.forEach(function(e,t){r(e,t)&&n.push(t);}),n},file:function(e,t,r){if(1!==arguments.length)return e=this.root+e,s.call(this,e,t,r),this;if(h(e)){var n=e;return this.filter(function(e,t){return !t.dir&&n.test(e)})}var i=this.files[this.root+e];return i&&!i.dir?i:null},folder:function(r){if(!r)return this;if(h(r))return this.filter(function(e,t){return t.dir&&r.test(e)});var e=this.root+r,t=b.call(this,e),n=this.clone();return n.root=t.name,n},remove:function(r){r=this.root+r;var e=this.files[r];if(e||("/"!==r.slice(-1)&&(r+="/"),e=this.files[r]),e&&!e.dir)delete this.files[r];else for(var t=this.filter(function(e,t){return t.name.slice(0,r.length)===r}),n=0;n<t.length;n++)delete this.files[t[n].name];return this},generate:function(){throw new Error("This method has been removed in JSZip 3.0, please check the upgrade guide.")},generateInternalStream:function(e){var t,r={};try{if((r=u.extend(e||{},{streamFiles:!1,compression:"STORE",compressionOptions:null,type:"",platform:"DOS",comment:null,mimeType:"application/zip",encodeFileName:i.utf8encode})).type=r.type.toLowerCase(),r.compression=r.compression.toUpperCase(),"binarystring"===r.type&&(r.type="string"),!r.type)throw new Error("No output type specified.");u.checkSupport(r.type),"darwin"!==r.platform&&"freebsd"!==r.platform&&"linux"!==r.platform&&"sunos"!==r.platform||(r.platform="UNIX"),"win32"===r.platform&&(r.platform="DOS");var n=r.comment||this.comment||"";t=o.generateWorker(this,r,n);}catch(e){(t=new l("error")).error(e);}return new a(t,r.type||"string",r.mimeType)},generateAsync:function(e,t){return this.generateInternalStream(e).accumulate(t)},generateNodeStream:function(e,t){return (e=e||{}).type||(e.type="nodebuffer"),this.generateInternalStream(e).toNodejsStream(t)}};t.exports=n;},{"./compressedObject":2,"./defaults":5,"./generate":9,"./nodejs/NodejsStreamInputAdapter":12,"./nodejsUtils":14,"./stream/GenericWorker":28,"./stream/StreamHelper":29,"./utf8":31,"./utils":32,"./zipObject":35}],16:[function(e,t,r){t.exports=e("stream");},{stream:void 0}],17:[function(e,t,r){var n=e("./DataReader");function i(e){n.call(this,e);for(var t=0;t<this.data.length;t++)e[t]=255&e[t];}e("../utils").inherits(i,n),i.prototype.byteAt=function(e){return this.data[this.zero+e]},i.prototype.lastIndexOfSignature=function(e){for(var t=e.charCodeAt(0),r=e.charCodeAt(1),n=e.charCodeAt(2),i=e.charCodeAt(3),s=this.length-4;0<=s;--s)if(this.data[s]===t&&this.data[s+1]===r&&this.data[s+2]===n&&this.data[s+3]===i)return s-this.zero;return -1},i.prototype.readAndCheckSignature=function(e){var t=e.charCodeAt(0),r=e.charCodeAt(1),n=e.charCodeAt(2),i=e.charCodeAt(3),s=this.readData(4);return t===s[0]&&r===s[1]&&n===s[2]&&i===s[3]},i.prototype.readData=function(e){if(this.checkOffset(e),0===e)return [];var t=this.data.slice(this.zero+this.index,this.zero+this.index+e);return this.index+=e,t},t.exports=i;},{"../utils":32,"./DataReader":18}],18:[function(e,t,r){var n=e("../utils");function i(e){this.data=e,this.length=e.length,this.index=0,this.zero=0;}i.prototype={checkOffset:function(e){this.checkIndex(this.index+e);},checkIndex:function(e){if(this.length<this.zero+e||e<0)throw new Error("End of data reached (data length = "+this.length+", asked index = "+e+"). Corrupted zip ?")},setIndex:function(e){this.checkIndex(e),this.index=e;},skip:function(e){this.setIndex(this.index+e);},byteAt:function(){},readInt:function(e){var t,r=0;for(this.checkOffset(e),t=this.index+e-1;t>=this.index;t--)r=(r<<8)+this.byteAt(t);return this.index+=e,r},readString:function(e){return n.transformTo("string",this.readData(e))},readData:function(){},lastIndexOfSignature:function(){},readAndCheckSignature:function(){},readDate:function(){var e=this.readInt(4);return new Date(Date.UTC(1980+(e>>25&127),(e>>21&15)-1,e>>16&31,e>>11&31,e>>5&63,(31&e)<<1))}},t.exports=i;},{"../utils":32}],19:[function(e,t,r){var n=e("./Uint8ArrayReader");function i(e){n.call(this,e);}e("../utils").inherits(i,n),i.prototype.readData=function(e){this.checkOffset(e);var t=this.data.slice(this.zero+this.index,this.zero+this.index+e);return this.index+=e,t},t.exports=i;},{"../utils":32,"./Uint8ArrayReader":21}],20:[function(e,t,r){var n=e("./DataReader");function i(e){n.call(this,e);}e("../utils").inherits(i,n),i.prototype.byteAt=function(e){return this.data.charCodeAt(this.zero+e)},i.prototype.lastIndexOfSignature=function(e){return this.data.lastIndexOf(e)-this.zero},i.prototype.readAndCheckSignature=function(e){return e===this.readData(4)},i.prototype.readData=function(e){this.checkOffset(e);var t=this.data.slice(this.zero+this.index,this.zero+this.index+e);return this.index+=e,t},t.exports=i;},{"../utils":32,"./DataReader":18}],21:[function(e,t,r){var n=e("./ArrayReader");function i(e){n.call(this,e);}e("../utils").inherits(i,n),i.prototype.readData=function(e){if(this.checkOffset(e),0===e)return new Uint8Array(0);var t=this.data.subarray(this.zero+this.index,this.zero+this.index+e);return this.index+=e,t},t.exports=i;},{"../utils":32,"./ArrayReader":17}],22:[function(e,t,r){var n=e("../utils"),i=e("../support"),s=e("./ArrayReader"),a=e("./StringReader"),o=e("./NodeBufferReader"),h=e("./Uint8ArrayReader");t.exports=function(e){var t=n.getTypeOf(e);return n.checkSupport(t),"string"!==t||i.uint8array?"nodebuffer"===t?new o(e):i.uint8array?new h(n.transformTo("uint8array",e)):new s(n.transformTo("array",e)):new a(e)};},{"../support":30,"../utils":32,"./ArrayReader":17,"./NodeBufferReader":19,"./StringReader":20,"./Uint8ArrayReader":21}],23:[function(e,t,r){r.LOCAL_FILE_HEADER="PK",r.CENTRAL_FILE_HEADER="PK",r.CENTRAL_DIRECTORY_END="PK",r.ZIP64_CENTRAL_DIRECTORY_LOCATOR="PK",r.ZIP64_CENTRAL_DIRECTORY_END="PK",r.DATA_DESCRIPTOR="PK\b";},{}],24:[function(e,t,r){var n=e("./GenericWorker"),i=e("../utils");function s(e){n.call(this,"ConvertWorker to "+e),this.destType=e;}i.inherits(s,n),s.prototype.processChunk=function(e){this.push({data:i.transformTo(this.destType,e.data),meta:e.meta});},t.exports=s;},{"../utils":32,"./GenericWorker":28}],25:[function(e,t,r){var n=e("./GenericWorker"),i=e("../crc32");function s(){n.call(this,"Crc32Probe"),this.withStreamInfo("crc32",0);}e("../utils").inherits(s,n),s.prototype.processChunk=function(e){this.streamInfo.crc32=i(e.data,this.streamInfo.crc32||0),this.push(e);},t.exports=s;},{"../crc32":4,"../utils":32,"./GenericWorker":28}],26:[function(e,t,r){var n=e("../utils"),i=e("./GenericWorker");function s(e){i.call(this,"DataLengthProbe for "+e),this.propName=e,this.withStreamInfo(e,0);}n.inherits(s,i),s.prototype.processChunk=function(e){if(e){var t=this.streamInfo[this.propName]||0;this.streamInfo[this.propName]=t+e.data.length;}i.prototype.processChunk.call(this,e);},t.exports=s;},{"../utils":32,"./GenericWorker":28}],27:[function(e,t,r){var n=e("../utils"),i=e("./GenericWorker");function s(e){i.call(this,"DataWorker");var t=this;this.dataIsReady=!1,this.index=0,this.max=0,this.data=null,this.type="",this._tickScheduled=!1,e.then(function(e){t.dataIsReady=!0,t.data=e,t.max=e&&e.length||0,t.type=n.getTypeOf(e),t.isPaused||t._tickAndRepeat();},function(e){t.error(e);});}n.inherits(s,i),s.prototype.cleanUp=function(){i.prototype.cleanUp.call(this),this.data=null;},s.prototype.resume=function(){return !!i.prototype.resume.call(this)&&(!this._tickScheduled&&this.dataIsReady&&(this._tickScheduled=!0,n.delay(this._tickAndRepeat,[],this)),!0)},s.prototype._tickAndRepeat=function(){this._tickScheduled=!1,this.isPaused||this.isFinished||(this._tick(),this.isFinished||(n.delay(this._tickAndRepeat,[],this),this._tickScheduled=!0));},s.prototype._tick=function(){if(this.isPaused||this.isFinished)return !1;var e=null,t=Math.min(this.max,this.index+16384);if(this.index>=this.max)return this.end();switch(this.type){case"string":e=this.data.substring(this.index,t);break;case"uint8array":e=this.data.subarray(this.index,t);break;case"array":case"nodebuffer":e=this.data.slice(this.index,t);}return this.index=t,this.push({data:e,meta:{percent:this.max?this.index/this.max*100:0}})},t.exports=s;},{"../utils":32,"./GenericWorker":28}],28:[function(e,t,r){function n(e){this.name=e||"default",this.streamInfo={},this.generatedError=null,this.extraStreamInfo={},this.isPaused=!0,this.isFinished=!1,this.isLocked=!1,this._listeners={data:[],end:[],error:[]},this.previous=null;}n.prototype={push:function(e){this.emit("data",e);},end:function(){if(this.isFinished)return !1;this.flush();try{this.emit("end"),this.cleanUp(),this.isFinished=!0;}catch(e){this.emit("error",e);}return !0},error:function(e){return !this.isFinished&&(this.isPaused?this.generatedError=e:(this.isFinished=!0,this.emit("error",e),this.previous&&this.previous.error(e),this.cleanUp()),!0)},on:function(e,t){return this._listeners[e].push(t),this},cleanUp:function(){this.streamInfo=this.generatedError=this.extraStreamInfo=null,this._listeners=[];},emit:function(e,t){if(this._listeners[e])for(var r=0;r<this._listeners[e].length;r++)this._listeners[e][r].call(this,t);},pipe:function(e){return e.registerPrevious(this)},registerPrevious:function(e){if(this.isLocked)throw new Error("The stream '"+this+"' has already been used.");this.streamInfo=e.streamInfo,this.mergeStreamInfo(),this.previous=e;var t=this;return e.on("data",function(e){t.processChunk(e);}),e.on("end",function(){t.end();}),e.on("error",function(e){t.error(e);}),this},pause:function(){return !this.isPaused&&!this.isFinished&&(this.isPaused=!0,this.previous&&this.previous.pause(),!0)},resume:function(){if(!this.isPaused||this.isFinished)return !1;var e=this.isPaused=!1;return this.generatedError&&(this.error(this.generatedError),e=!0),this.previous&&this.previous.resume(),!e},flush:function(){},processChunk:function(e){this.push(e);},withStreamInfo:function(e,t){return this.extraStreamInfo[e]=t,this.mergeStreamInfo(),this},mergeStreamInfo:function(){for(var e in this.extraStreamInfo)Object.prototype.hasOwnProperty.call(this.extraStreamInfo,e)&&(this.streamInfo[e]=this.extraStreamInfo[e]);},lock:function(){if(this.isLocked)throw new Error("The stream '"+this+"' has already been used.");this.isLocked=!0,this.previous&&this.previous.lock();},toString:function(){var e="Worker "+this.name;return this.previous?this.previous+" -> "+e:e}},t.exports=n;},{}],29:[function(e,t,r){var h=e("../utils"),i=e("./ConvertWorker"),s=e("./GenericWorker"),u=e("../base64"),n=e("../support"),a=e("../external"),o=null;if(n.nodestream)try{o=e("../nodejs/NodejsStreamOutputAdapter");}catch(e){}function l(e,o){return new a.Promise(function(t,r){var n=[],i=e._internalType,s=e._outputType,a=e._mimeType;e.on("data",function(e,t){n.push(e),o&&o(t);}).on("error",function(e){n=[],r(e);}).on("end",function(){try{var e=function(e,t,r){switch(e){case"blob":return h.newBlob(h.transformTo("arraybuffer",t),r);case"base64":return u.encode(t);default:return h.transformTo(e,t)}}(s,function(e,t){var r,n=0,i=null,s=0;for(r=0;r<t.length;r++)s+=t[r].length;switch(e){case"string":return t.join("");case"array":return Array.prototype.concat.apply([],t);case"uint8array":for(i=new Uint8Array(s),r=0;r<t.length;r++)i.set(t[r],n),n+=t[r].length;return i;case"nodebuffer":return Buffer.concat(t);default:throw new Error("concat : unsupported type '"+e+"'")}}(i,n),a);t(e);}catch(e){r(e);}n=[];}).resume();})}function f(e,t,r){var n=t;switch(t){case"blob":case"arraybuffer":n="uint8array";break;case"base64":n="string";}try{this._internalType=n,this._outputType=t,this._mimeType=r,h.checkSupport(n),this._worker=e.pipe(new i(n)),e.lock();}catch(e){this._worker=new s("error"),this._worker.error(e);}}f.prototype={accumulate:function(e){return l(this,e)},on:function(e,t){var r=this;return "data"===e?this._worker.on(e,function(e){t.call(r,e.data,e.meta);}):this._worker.on(e,function(){h.delay(t,arguments,r);}),this},resume:function(){return h.delay(this._worker.resume,[],this._worker),this},pause:function(){return this._worker.pause(),this},toNodejsStream:function(e){if(h.checkSupport("nodestream"),"nodebuffer"!==this._outputType)throw new Error(this._outputType+" is not supported by this method");return new o(this,{objectMode:"nodebuffer"!==this._outputType},e)}},t.exports=f;},{"../base64":1,"../external":6,"../nodejs/NodejsStreamOutputAdapter":13,"../support":30,"../utils":32,"./ConvertWorker":24,"./GenericWorker":28}],30:[function(e,t,r){if(r.base64=!0,r.array=!0,r.string=!0,r.arraybuffer="undefined"!=typeof ArrayBuffer&&"undefined"!=typeof Uint8Array,r.nodebuffer="undefined"!=typeof Buffer,r.uint8array="undefined"!=typeof Uint8Array,"undefined"==typeof ArrayBuffer)r.blob=!1;else {var n=new ArrayBuffer(0);try{r.blob=0===new Blob([n],{type:"application/zip"}).size;}catch(e){try{var i=new(self.BlobBuilder||self.WebKitBlobBuilder||self.MozBlobBuilder||self.MSBlobBuilder);i.append(n),r.blob=0===i.getBlob("application/zip").size;}catch(e){r.blob=!1;}}}try{r.nodestream=!!e("readable-stream").Readable;}catch(e){r.nodestream=!1;}},{"readable-stream":16}],31:[function(e,t,s){for(var o=e("./utils"),h=e("./support"),r=e("./nodejsUtils"),n=e("./stream/GenericWorker"),u=new Array(256),i=0;i<256;i++)u[i]=252<=i?6:248<=i?5:240<=i?4:224<=i?3:192<=i?2:1;u[254]=u[254]=1;function a(){n.call(this,"utf-8 decode"),this.leftOver=null;}function l(){n.call(this,"utf-8 encode");}s.utf8encode=function(e){return h.nodebuffer?r.newBufferFrom(e,"utf-8"):function(e){var t,r,n,i,s,a=e.length,o=0;for(i=0;i<a;i++)55296==(64512&(r=e.charCodeAt(i)))&&i+1<a&&56320==(64512&(n=e.charCodeAt(i+1)))&&(r=65536+(r-55296<<10)+(n-56320),i++),o+=r<128?1:r<2048?2:r<65536?3:4;for(t=h.uint8array?new Uint8Array(o):new Array(o),i=s=0;s<o;i++)55296==(64512&(r=e.charCodeAt(i)))&&i+1<a&&56320==(64512&(n=e.charCodeAt(i+1)))&&(r=65536+(r-55296<<10)+(n-56320),i++),r<128?t[s++]=r:(r<2048?t[s++]=192|r>>>6:(r<65536?t[s++]=224|r>>>12:(t[s++]=240|r>>>18,t[s++]=128|r>>>12&63),t[s++]=128|r>>>6&63),t[s++]=128|63&r);return t}(e)},s.utf8decode=function(e){return h.nodebuffer?o.transformTo("nodebuffer",e).toString("utf-8"):function(e){var t,r,n,i,s=e.length,a=new Array(2*s);for(t=r=0;t<s;)if((n=e[t++])<128)a[r++]=n;else if(4<(i=u[n]))a[r++]=65533,t+=i-1;else {for(n&=2===i?31:3===i?15:7;1<i&&t<s;)n=n<<6|63&e[t++],i--;1<i?a[r++]=65533:n<65536?a[r++]=n:(n-=65536,a[r++]=55296|n>>10&1023,a[r++]=56320|1023&n);}return a.length!==r&&(a.subarray?a=a.subarray(0,r):a.length=r),o.applyFromCharCode(a)}(e=o.transformTo(h.uint8array?"uint8array":"array",e))},o.inherits(a,n),a.prototype.processChunk=function(e){var t=o.transformTo(h.uint8array?"uint8array":"array",e.data);if(this.leftOver&&this.leftOver.length){if(h.uint8array){var r=t;(t=new Uint8Array(r.length+this.leftOver.length)).set(this.leftOver,0),t.set(r,this.leftOver.length);}else t=this.leftOver.concat(t);this.leftOver=null;}var n=function(e,t){var r;for((t=t||e.length)>e.length&&(t=e.length),r=t-1;0<=r&&128==(192&e[r]);)r--;return r<0?t:0===r?t:r+u[e[r]]>t?r:t}(t),i=t;n!==t.length&&(h.uint8array?(i=t.subarray(0,n),this.leftOver=t.subarray(n,t.length)):(i=t.slice(0,n),this.leftOver=t.slice(n,t.length))),this.push({data:s.utf8decode(i),meta:e.meta});},a.prototype.flush=function(){this.leftOver&&this.leftOver.length&&(this.push({data:s.utf8decode(this.leftOver),meta:{}}),this.leftOver=null);},s.Utf8DecodeWorker=a,o.inherits(l,n),l.prototype.processChunk=function(e){this.push({data:s.utf8encode(e.data),meta:e.meta});},s.Utf8EncodeWorker=l;},{"./nodejsUtils":14,"./stream/GenericWorker":28,"./support":30,"./utils":32}],32:[function(e,t,a){var o=e("./support"),h=e("./base64"),r=e("./nodejsUtils"),u=e("./external");function n(e){return e}function l(e,t){for(var r=0;r<e.length;++r)t[r]=255&e.charCodeAt(r);return t}e("setimmediate"),a.newBlob=function(t,r){a.checkSupport("blob");try{return new Blob([t],{type:r})}catch(e){try{var n=new(self.BlobBuilder||self.WebKitBlobBuilder||self.MozBlobBuilder||self.MSBlobBuilder);return n.append(t),n.getBlob(r)}catch(e){throw new Error("Bug : can't construct the Blob.")}}};var i={stringifyByChunk:function(e,t,r){var n=[],i=0,s=e.length;if(s<=r)return String.fromCharCode.apply(null,e);for(;i<s;)"array"===t||"nodebuffer"===t?n.push(String.fromCharCode.apply(null,e.slice(i,Math.min(i+r,s)))):n.push(String.fromCharCode.apply(null,e.subarray(i,Math.min(i+r,s)))),i+=r;return n.join("")},stringifyByChar:function(e){for(var t="",r=0;r<e.length;r++)t+=String.fromCharCode(e[r]);return t},applyCanBeUsed:{uint8array:function(){try{return o.uint8array&&1===String.fromCharCode.apply(null,new Uint8Array(1)).length}catch(e){return !1}}(),nodebuffer:function(){try{return o.nodebuffer&&1===String.fromCharCode.apply(null,r.allocBuffer(1)).length}catch(e){return !1}}()}};function s(e){var t=65536,r=a.getTypeOf(e),n=!0;if("uint8array"===r?n=i.applyCanBeUsed.uint8array:"nodebuffer"===r&&(n=i.applyCanBeUsed.nodebuffer),n)for(;1<t;)try{return i.stringifyByChunk(e,r,t)}catch(e){t=Math.floor(t/2);}return i.stringifyByChar(e)}function f(e,t){for(var r=0;r<e.length;r++)t[r]=e[r];return t}a.applyFromCharCode=s;var c={};c.string={string:n,array:function(e){return l(e,new Array(e.length))},arraybuffer:function(e){return c.string.uint8array(e).buffer},uint8array:function(e){return l(e,new Uint8Array(e.length))},nodebuffer:function(e){return l(e,r.allocBuffer(e.length))}},c.array={string:s,array:n,arraybuffer:function(e){return new Uint8Array(e).buffer},uint8array:function(e){return new Uint8Array(e)},nodebuffer:function(e){return r.newBufferFrom(e)}},c.arraybuffer={string:function(e){return s(new Uint8Array(e))},array:function(e){return f(new Uint8Array(e),new Array(e.byteLength))},arraybuffer:n,uint8array:function(e){return new Uint8Array(e)},nodebuffer:function(e){return r.newBufferFrom(new Uint8Array(e))}},c.uint8array={string:s,array:function(e){return f(e,new Array(e.length))},arraybuffer:function(e){return e.buffer},uint8array:n,nodebuffer:function(e){return r.newBufferFrom(e)}},c.nodebuffer={string:s,array:function(e){return f(e,new Array(e.length))},arraybuffer:function(e){return c.nodebuffer.uint8array(e).buffer},uint8array:function(e){return f(e,new Uint8Array(e.length))},nodebuffer:n},a.transformTo=function(e,t){if(t=t||"",!e)return t;a.checkSupport(e);var r=a.getTypeOf(t);return c[r][e](t)},a.resolve=function(e){for(var t=e.split("/"),r=[],n=0;n<t.length;n++){var i=t[n];"."===i||""===i&&0!==n&&n!==t.length-1||(".."===i?r.pop():r.push(i));}return r.join("/")},a.getTypeOf=function(e){return "string"==typeof e?"string":"[object Array]"===Object.prototype.toString.call(e)?"array":o.nodebuffer&&r.isBuffer(e)?"nodebuffer":o.uint8array&&e instanceof Uint8Array?"uint8array":o.arraybuffer&&e instanceof ArrayBuffer?"arraybuffer":void 0},a.checkSupport=function(e){if(!o[e.toLowerCase()])throw new Error(e+" is not supported by this platform")},a.MAX_VALUE_16BITS=65535,a.MAX_VALUE_32BITS=-1,a.pretty=function(e){var t,r,n="";for(r=0;r<(e||"").length;r++)n+="\\x"+((t=e.charCodeAt(r))<16?"0":"")+t.toString(16).toUpperCase();return n},a.delay=function(e,t,r){setImmediate(function(){e.apply(r||null,t||[]);});},a.inherits=function(e,t){function r(){}r.prototype=t.prototype,e.prototype=new r;},a.extend=function(){var e,t,r={};for(e=0;e<arguments.length;e++)for(t in arguments[e])Object.prototype.hasOwnProperty.call(arguments[e],t)&&void 0===r[t]&&(r[t]=arguments[e][t]);return r},a.prepareContent=function(r,e,n,i,s){return u.Promise.resolve(e).then(function(n){return o.blob&&(n instanceof Blob||-1!==["[object File]","[object Blob]"].indexOf(Object.prototype.toString.call(n)))&&"undefined"!=typeof FileReader?new u.Promise(function(t,r){var e=new FileReader;e.onload=function(e){t(e.target.result);},e.onerror=function(e){r(e.target.error);},e.readAsArrayBuffer(n);}):n}).then(function(e){var t=a.getTypeOf(e);return t?("arraybuffer"===t?e=a.transformTo("uint8array",e):"string"===t&&(s?e=h.decode(e):n&&!0!==i&&(e=function(e){return l(e,o.uint8array?new Uint8Array(e.length):new Array(e.length))}(e))),e):u.Promise.reject(new Error("Can't read the data of '"+r+"'. Is it in a supported JavaScript type (String, Blob, ArrayBuffer, etc) ?"))})};},{"./base64":1,"./external":6,"./nodejsUtils":14,"./support":30,setimmediate:54}],33:[function(e,t,r){var n=e("./reader/readerFor"),i=e("./utils"),s=e("./signature"),a=e("./zipEntry"),o=e("./support");function h(e){this.files=[],this.loadOptions=e;}h.prototype={checkSignature:function(e){if(!this.reader.readAndCheckSignature(e)){this.reader.index-=4;var t=this.reader.readString(4);throw new Error("Corrupted zip or bug: unexpected signature ("+i.pretty(t)+", expected "+i.pretty(e)+")")}},isSignature:function(e,t){var r=this.reader.index;this.reader.setIndex(e);var n=this.reader.readString(4)===t;return this.reader.setIndex(r),n},readBlockEndOfCentral:function(){this.diskNumber=this.reader.readInt(2),this.diskWithCentralDirStart=this.reader.readInt(2),this.centralDirRecordsOnThisDisk=this.reader.readInt(2),this.centralDirRecords=this.reader.readInt(2),this.centralDirSize=this.reader.readInt(4),this.centralDirOffset=this.reader.readInt(4),this.zipCommentLength=this.reader.readInt(2);var e=this.reader.readData(this.zipCommentLength),t=o.uint8array?"uint8array":"array",r=i.transformTo(t,e);this.zipComment=this.loadOptions.decodeFileName(r);},readBlockZip64EndOfCentral:function(){this.zip64EndOfCentralSize=this.reader.readInt(8),this.reader.skip(4),this.diskNumber=this.reader.readInt(4),this.diskWithCentralDirStart=this.reader.readInt(4),this.centralDirRecordsOnThisDisk=this.reader.readInt(8),this.centralDirRecords=this.reader.readInt(8),this.centralDirSize=this.reader.readInt(8),this.centralDirOffset=this.reader.readInt(8),this.zip64ExtensibleData={};for(var e,t,r,n=this.zip64EndOfCentralSize-44;0<n;)e=this.reader.readInt(2),t=this.reader.readInt(4),r=this.reader.readData(t),this.zip64ExtensibleData[e]={id:e,length:t,value:r};},readBlockZip64EndOfCentralLocator:function(){if(this.diskWithZip64CentralDirStart=this.reader.readInt(4),this.relativeOffsetEndOfZip64CentralDir=this.reader.readInt(8),this.disksCount=this.reader.readInt(4),1<this.disksCount)throw new Error("Multi-volumes zip are not supported")},readLocalFiles:function(){var e,t;for(e=0;e<this.files.length;e++)t=this.files[e],this.reader.setIndex(t.localHeaderOffset),this.checkSignature(s.LOCAL_FILE_HEADER),t.readLocalPart(this.reader),t.handleUTF8(),t.processAttributes();},readCentralDir:function(){var e;for(this.reader.setIndex(this.centralDirOffset);this.reader.readAndCheckSignature(s.CENTRAL_FILE_HEADER);)(e=new a({zip64:this.zip64},this.loadOptions)).readCentralPart(this.reader),this.files.push(e);if(this.centralDirRecords!==this.files.length&&0!==this.centralDirRecords&&0===this.files.length)throw new Error("Corrupted zip or bug: expected "+this.centralDirRecords+" records in central dir, got "+this.files.length)},readEndOfCentral:function(){var e=this.reader.lastIndexOfSignature(s.CENTRAL_DIRECTORY_END);if(e<0)throw !this.isSignature(0,s.LOCAL_FILE_HEADER)?new Error("Can't find end of central directory : is this a zip file ? If it is, see https://stuk.github.io/jszip/documentation/howto/read_zip.html"):new Error("Corrupted zip: can't find end of central directory");this.reader.setIndex(e);var t=e;if(this.checkSignature(s.CENTRAL_DIRECTORY_END),this.readBlockEndOfCentral(),this.diskNumber===i.MAX_VALUE_16BITS||this.diskWithCentralDirStart===i.MAX_VALUE_16BITS||this.centralDirRecordsOnThisDisk===i.MAX_VALUE_16BITS||this.centralDirRecords===i.MAX_VALUE_16BITS||this.centralDirSize===i.MAX_VALUE_32BITS||this.centralDirOffset===i.MAX_VALUE_32BITS){if(this.zip64=!0,(e=this.reader.lastIndexOfSignature(s.ZIP64_CENTRAL_DIRECTORY_LOCATOR))<0)throw new Error("Corrupted zip: can't find the ZIP64 end of central directory locator");if(this.reader.setIndex(e),this.checkSignature(s.ZIP64_CENTRAL_DIRECTORY_LOCATOR),this.readBlockZip64EndOfCentralLocator(),!this.isSignature(this.relativeOffsetEndOfZip64CentralDir,s.ZIP64_CENTRAL_DIRECTORY_END)&&(this.relativeOffsetEndOfZip64CentralDir=this.reader.lastIndexOfSignature(s.ZIP64_CENTRAL_DIRECTORY_END),this.relativeOffsetEndOfZip64CentralDir<0))throw new Error("Corrupted zip: can't find the ZIP64 end of central directory");this.reader.setIndex(this.relativeOffsetEndOfZip64CentralDir),this.checkSignature(s.ZIP64_CENTRAL_DIRECTORY_END),this.readBlockZip64EndOfCentral();}var r=this.centralDirOffset+this.centralDirSize;this.zip64&&(r+=20,r+=12+this.zip64EndOfCentralSize);var n=t-r;if(0<n)this.isSignature(t,s.CENTRAL_FILE_HEADER)||(this.reader.zero=n);else if(n<0)throw new Error("Corrupted zip: missing "+Math.abs(n)+" bytes.")},prepareReader:function(e){this.reader=n(e);},load:function(e){this.prepareReader(e),this.readEndOfCentral(),this.readCentralDir(),this.readLocalFiles();}},t.exports=h;},{"./reader/readerFor":22,"./signature":23,"./support":30,"./utils":32,"./zipEntry":34}],34:[function(e,t,r){var n=e("./reader/readerFor"),s=e("./utils"),i=e("./compressedObject"),a=e("./crc32"),o=e("./utf8"),h=e("./compressions"),u=e("./support");function l(e,t){this.options=e,this.loadOptions=t;}l.prototype={isEncrypted:function(){return 1==(1&this.bitFlag)},useUTF8:function(){return 2048==(2048&this.bitFlag)},readLocalPart:function(e){var t,r;if(e.skip(22),this.fileNameLength=e.readInt(2),r=e.readInt(2),this.fileName=e.readData(this.fileNameLength),e.skip(r),-1===this.compressedSize||-1===this.uncompressedSize)throw new Error("Bug or corrupted zip : didn't get enough information from the central directory (compressedSize === -1 || uncompressedSize === -1)");if(null===(t=function(e){for(var t in h)if(Object.prototype.hasOwnProperty.call(h,t)&&h[t].magic===e)return h[t];return null}(this.compressionMethod)))throw new Error("Corrupted zip : compression "+s.pretty(this.compressionMethod)+" unknown (inner file : "+s.transformTo("string",this.fileName)+")");this.decompressed=new i(this.compressedSize,this.uncompressedSize,this.crc32,t,e.readData(this.compressedSize));},readCentralPart:function(e){this.versionMadeBy=e.readInt(2),e.skip(2),this.bitFlag=e.readInt(2),this.compressionMethod=e.readString(2),this.date=e.readDate(),this.crc32=e.readInt(4),this.compressedSize=e.readInt(4),this.uncompressedSize=e.readInt(4);var t=e.readInt(2);if(this.extraFieldsLength=e.readInt(2),this.fileCommentLength=e.readInt(2),this.diskNumberStart=e.readInt(2),this.internalFileAttributes=e.readInt(2),this.externalFileAttributes=e.readInt(4),this.localHeaderOffset=e.readInt(4),this.isEncrypted())throw new Error("Encrypted zip are not supported");e.skip(t),this.readExtraFields(e),this.parseZIP64ExtraField(e),this.fileComment=e.readData(this.fileCommentLength);},processAttributes:function(){this.unixPermissions=null,this.dosPermissions=null;var e=this.versionMadeBy>>8;this.dir=!!(16&this.externalFileAttributes),0==e&&(this.dosPermissions=63&this.externalFileAttributes),3==e&&(this.unixPermissions=this.externalFileAttributes>>16&65535),this.dir||"/"!==this.fileNameStr.slice(-1)||(this.dir=!0);},parseZIP64ExtraField:function(){if(this.extraFields[1]){var e=n(this.extraFields[1].value);this.uncompressedSize===s.MAX_VALUE_32BITS&&(this.uncompressedSize=e.readInt(8)),this.compressedSize===s.MAX_VALUE_32BITS&&(this.compressedSize=e.readInt(8)),this.localHeaderOffset===s.MAX_VALUE_32BITS&&(this.localHeaderOffset=e.readInt(8)),this.diskNumberStart===s.MAX_VALUE_32BITS&&(this.diskNumberStart=e.readInt(4));}},readExtraFields:function(e){var t,r,n,i=e.index+this.extraFieldsLength;for(this.extraFields||(this.extraFields={});e.index+4<i;)t=e.readInt(2),r=e.readInt(2),n=e.readData(r),this.extraFields[t]={id:t,length:r,value:n};e.setIndex(i);},handleUTF8:function(){var e=u.uint8array?"uint8array":"array";if(this.useUTF8())this.fileNameStr=o.utf8decode(this.fileName),this.fileCommentStr=o.utf8decode(this.fileComment);else {var t=this.findExtraFieldUnicodePath();if(null!==t)this.fileNameStr=t;else {var r=s.transformTo(e,this.fileName);this.fileNameStr=this.loadOptions.decodeFileName(r);}var n=this.findExtraFieldUnicodeComment();if(null!==n)this.fileCommentStr=n;else {var i=s.transformTo(e,this.fileComment);this.fileCommentStr=this.loadOptions.decodeFileName(i);}}},findExtraFieldUnicodePath:function(){var e=this.extraFields[28789];if(e){var t=n(e.value);return 1!==t.readInt(1)?null:a(this.fileName)!==t.readInt(4)?null:o.utf8decode(t.readData(e.length-5))}return null},findExtraFieldUnicodeComment:function(){var e=this.extraFields[25461];if(e){var t=n(e.value);return 1!==t.readInt(1)?null:a(this.fileComment)!==t.readInt(4)?null:o.utf8decode(t.readData(e.length-5))}return null}},t.exports=l;},{"./compressedObject":2,"./compressions":3,"./crc32":4,"./reader/readerFor":22,"./support":30,"./utf8":31,"./utils":32}],35:[function(e,t,r){function n(e,t,r){this.name=e,this.dir=r.dir,this.date=r.date,this.comment=r.comment,this.unixPermissions=r.unixPermissions,this.dosPermissions=r.dosPermissions,this._data=t,this._dataBinary=r.binary,this.options={compression:r.compression,compressionOptions:r.compressionOptions};}var s=e("./stream/StreamHelper"),i=e("./stream/DataWorker"),a=e("./utf8"),o=e("./compressedObject"),h=e("./stream/GenericWorker");n.prototype={internalStream:function(e){var t=null,r="string";try{if(!e)throw new Error("No output type specified.");var n="string"===(r=e.toLowerCase())||"text"===r;"binarystring"!==r&&"text"!==r||(r="string"),t=this._decompressWorker();var i=!this._dataBinary;i&&!n&&(t=t.pipe(new a.Utf8EncodeWorker)),!i&&n&&(t=t.pipe(new a.Utf8DecodeWorker));}catch(e){(t=new h("error")).error(e);}return new s(t,r,"")},async:function(e,t){return this.internalStream(e).accumulate(t)},nodeStream:function(e,t){return this.internalStream(e||"nodebuffer").toNodejsStream(t)},_compressWorker:function(e,t){if(this._data instanceof o&&this._data.compression.magic===e.magic)return this._data.getCompressedWorker();var r=this._decompressWorker();return this._dataBinary||(r=r.pipe(new a.Utf8EncodeWorker)),o.createWorkerFrom(r,e,t)},_decompressWorker:function(){return this._data instanceof o?this._data.getContentWorker():this._data instanceof h?this._data:new i(this._data)}};for(var u=["asText","asBinary","asNodeBuffer","asUint8Array","asArrayBuffer"],l=function(){throw new Error("This method has been removed in JSZip 3.0, please check the upgrade guide.")},f=0;f<u.length;f++)n.prototype[u[f]]=l;t.exports=n;},{"./compressedObject":2,"./stream/DataWorker":27,"./stream/GenericWorker":28,"./stream/StreamHelper":29,"./utf8":31}],36:[function(e,l,t){(function(t){var r,n,e=t.MutationObserver||t.WebKitMutationObserver;if(e){var i=0,s=new e(u),a=t.document.createTextNode("");s.observe(a,{characterData:!0}),r=function(){a.data=i=++i%2;};}else if(t.setImmediate||void 0===t.MessageChannel)r="document"in t&&"onreadystatechange"in t.document.createElement("script")?function(){var e=t.document.createElement("script");e.onreadystatechange=function(){u(),e.onreadystatechange=null,e.parentNode.removeChild(e),e=null;},t.document.documentElement.appendChild(e);}:function(){setTimeout(u,0);};else {var o=new t.MessageChannel;o.port1.onmessage=u,r=function(){o.port2.postMessage(0);};}var h=[];function u(){var e,t;n=!0;for(var r=h.length;r;){for(t=h,h=[],e=-1;++e<r;)t[e]();r=h.length;}n=!1;}l.exports=function(e){1!==h.push(e)||n||r();};}).call(this,"undefined"!=typeof commonjsGlobal?commonjsGlobal:"undefined"!=typeof self?self:"undefined"!=typeof window?window:{});},{}],37:[function(e,t,r){var i=e("immediate");function u(){}var l={},s=["REJECTED"],a=["FULFILLED"],n=["PENDING"];function o(e){if("function"!=typeof e)throw new TypeError("resolver must be a function");this.state=n,this.queue=[],this.outcome=void 0,e!==u&&d(this,e);}function h(e,t,r){this.promise=e,"function"==typeof t&&(this.onFulfilled=t,this.callFulfilled=this.otherCallFulfilled),"function"==typeof r&&(this.onRejected=r,this.callRejected=this.otherCallRejected);}function f(t,r,n){i(function(){var e;try{e=r(n);}catch(e){return l.reject(t,e)}e===t?l.reject(t,new TypeError("Cannot resolve promise with itself")):l.resolve(t,e);});}function c(e){var t=e&&e.then;if(e&&("object"==typeof e||"function"==typeof e)&&"function"==typeof t)return function(){t.apply(e,arguments);}}function d(t,e){var r=!1;function n(e){r||(r=!0,l.reject(t,e));}function i(e){r||(r=!0,l.resolve(t,e));}var s=p(function(){e(i,n);});"error"===s.status&&n(s.value);}function p(e,t){var r={};try{r.value=e(t),r.status="success";}catch(e){r.status="error",r.value=e;}return r}(t.exports=o).prototype.finally=function(t){if("function"!=typeof t)return this;var r=this.constructor;return this.then(function(e){return r.resolve(t()).then(function(){return e})},function(e){return r.resolve(t()).then(function(){throw e})})},o.prototype.catch=function(e){return this.then(null,e)},o.prototype.then=function(e,t){if("function"!=typeof e&&this.state===a||"function"!=typeof t&&this.state===s)return this;var r=new this.constructor(u);this.state!==n?f(r,this.state===a?e:t,this.outcome):this.queue.push(new h(r,e,t));return r},h.prototype.callFulfilled=function(e){l.resolve(this.promise,e);},h.prototype.otherCallFulfilled=function(e){f(this.promise,this.onFulfilled,e);},h.prototype.callRejected=function(e){l.reject(this.promise,e);},h.prototype.otherCallRejected=function(e){f(this.promise,this.onRejected,e);},l.resolve=function(e,t){var r=p(c,t);if("error"===r.status)return l.reject(e,r.value);var n=r.value;if(n)d(e,n);else {e.state=a,e.outcome=t;for(var i=-1,s=e.queue.length;++i<s;)e.queue[i].callFulfilled(t);}return e},l.reject=function(e,t){e.state=s,e.outcome=t;for(var r=-1,n=e.queue.length;++r<n;)e.queue[r].callRejected(t);return e},o.resolve=function(e){if(e instanceof this)return e;return l.resolve(new this(u),e)},o.reject=function(e){var t=new this(u);return l.reject(t,e)},o.all=function(e){var r=this;if("[object Array]"!==Object.prototype.toString.call(e))return this.reject(new TypeError("must be an array"));var n=e.length,i=!1;if(!n)return this.resolve([]);var s=new Array(n),a=0,t=-1,o=new this(u);for(;++t<n;)h(e[t],t);return o;function h(e,t){r.resolve(e).then(function(e){s[t]=e,++a!==n||i||(i=!0,l.resolve(o,s));},function(e){i||(i=!0,l.reject(o,e));});}},o.race=function(e){var t=this;if("[object Array]"!==Object.prototype.toString.call(e))return this.reject(new TypeError("must be an array"));var r=e.length,n=!1;if(!r)return this.resolve([]);var i=-1,s=new this(u);for(;++i<r;)a=e[i],t.resolve(a).then(function(e){n||(n=!0,l.resolve(s,e));},function(e){n||(n=!0,l.reject(s,e));});var a;return s};},{immediate:36}],38:[function(e,t,r){var n={};(0, e("./lib/utils/common").assign)(n,e("./lib/deflate"),e("./lib/inflate"),e("./lib/zlib/constants")),t.exports=n;},{"./lib/deflate":39,"./lib/inflate":40,"./lib/utils/common":41,"./lib/zlib/constants":44}],39:[function(e,t,r){var a=e("./zlib/deflate"),o=e("./utils/common"),h=e("./utils/strings"),i=e("./zlib/messages"),s=e("./zlib/zstream"),u=Object.prototype.toString,l=0,f=-1,c=0,d=8;function p(e){if(!(this instanceof p))return new p(e);this.options=o.assign({level:f,method:d,chunkSize:16384,windowBits:15,memLevel:8,strategy:c,to:""},e||{});var t=this.options;t.raw&&0<t.windowBits?t.windowBits=-t.windowBits:t.gzip&&0<t.windowBits&&t.windowBits<16&&(t.windowBits+=16),this.err=0,this.msg="",this.ended=!1,this.chunks=[],this.strm=new s,this.strm.avail_out=0;var r=a.deflateInit2(this.strm,t.level,t.method,t.windowBits,t.memLevel,t.strategy);if(r!==l)throw new Error(i[r]);if(t.header&&a.deflateSetHeader(this.strm,t.header),t.dictionary){var n;if(n="string"==typeof t.dictionary?h.string2buf(t.dictionary):"[object ArrayBuffer]"===u.call(t.dictionary)?new Uint8Array(t.dictionary):t.dictionary,(r=a.deflateSetDictionary(this.strm,n))!==l)throw new Error(i[r]);this._dict_set=!0;}}function n(e,t){var r=new p(t);if(r.push(e,!0),r.err)throw r.msg||i[r.err];return r.result}p.prototype.push=function(e,t){var r,n,i=this.strm,s=this.options.chunkSize;if(this.ended)return !1;n=t===~~t?t:!0===t?4:0,"string"==typeof e?i.input=h.string2buf(e):"[object ArrayBuffer]"===u.call(e)?i.input=new Uint8Array(e):i.input=e,i.next_in=0,i.avail_in=i.input.length;do{if(0===i.avail_out&&(i.output=new o.Buf8(s),i.next_out=0,i.avail_out=s),1!==(r=a.deflate(i,n))&&r!==l)return this.onEnd(r),!(this.ended=!0);0!==i.avail_out&&(0!==i.avail_in||4!==n&&2!==n)||("string"===this.options.to?this.onData(h.buf2binstring(o.shrinkBuf(i.output,i.next_out))):this.onData(o.shrinkBuf(i.output,i.next_out)));}while((0<i.avail_in||0===i.avail_out)&&1!==r);return 4===n?(r=a.deflateEnd(this.strm),this.onEnd(r),this.ended=!0,r===l):2!==n||(this.onEnd(l),!(i.avail_out=0))},p.prototype.onData=function(e){this.chunks.push(e);},p.prototype.onEnd=function(e){e===l&&("string"===this.options.to?this.result=this.chunks.join(""):this.result=o.flattenChunks(this.chunks)),this.chunks=[],this.err=e,this.msg=this.strm.msg;},r.Deflate=p,r.deflate=n,r.deflateRaw=function(e,t){return (t=t||{}).raw=!0,n(e,t)},r.gzip=function(e,t){return (t=t||{}).gzip=!0,n(e,t)};},{"./utils/common":41,"./utils/strings":42,"./zlib/deflate":46,"./zlib/messages":51,"./zlib/zstream":53}],40:[function(e,t,r){var c=e("./zlib/inflate"),d=e("./utils/common"),p=e("./utils/strings"),m=e("./zlib/constants"),n=e("./zlib/messages"),i=e("./zlib/zstream"),s=e("./zlib/gzheader"),_=Object.prototype.toString;function a(e){if(!(this instanceof a))return new a(e);this.options=d.assign({chunkSize:16384,windowBits:0,to:""},e||{});var t=this.options;t.raw&&0<=t.windowBits&&t.windowBits<16&&(t.windowBits=-t.windowBits,0===t.windowBits&&(t.windowBits=-15)),!(0<=t.windowBits&&t.windowBits<16)||e&&e.windowBits||(t.windowBits+=32),15<t.windowBits&&t.windowBits<48&&0==(15&t.windowBits)&&(t.windowBits|=15),this.err=0,this.msg="",this.ended=!1,this.chunks=[],this.strm=new i,this.strm.avail_out=0;var r=c.inflateInit2(this.strm,t.windowBits);if(r!==m.Z_OK)throw new Error(n[r]);this.header=new s,c.inflateGetHeader(this.strm,this.header);}function o(e,t){var r=new a(t);if(r.push(e,!0),r.err)throw r.msg||n[r.err];return r.result}a.prototype.push=function(e,t){var r,n,i,s,a,o,h=this.strm,u=this.options.chunkSize,l=this.options.dictionary,f=!1;if(this.ended)return !1;n=t===~~t?t:!0===t?m.Z_FINISH:m.Z_NO_FLUSH,"string"==typeof e?h.input=p.binstring2buf(e):"[object ArrayBuffer]"===_.call(e)?h.input=new Uint8Array(e):h.input=e,h.next_in=0,h.avail_in=h.input.length;do{if(0===h.avail_out&&(h.output=new d.Buf8(u),h.next_out=0,h.avail_out=u),(r=c.inflate(h,m.Z_NO_FLUSH))===m.Z_NEED_DICT&&l&&(o="string"==typeof l?p.string2buf(l):"[object ArrayBuffer]"===_.call(l)?new Uint8Array(l):l,r=c.inflateSetDictionary(this.strm,o)),r===m.Z_BUF_ERROR&&!0===f&&(r=m.Z_OK,f=!1),r!==m.Z_STREAM_END&&r!==m.Z_OK)return this.onEnd(r),!(this.ended=!0);h.next_out&&(0!==h.avail_out&&r!==m.Z_STREAM_END&&(0!==h.avail_in||n!==m.Z_FINISH&&n!==m.Z_SYNC_FLUSH)||("string"===this.options.to?(i=p.utf8border(h.output,h.next_out),s=h.next_out-i,a=p.buf2string(h.output,i),h.next_out=s,h.avail_out=u-s,s&&d.arraySet(h.output,h.output,i,s,0),this.onData(a)):this.onData(d.shrinkBuf(h.output,h.next_out)))),0===h.avail_in&&0===h.avail_out&&(f=!0);}while((0<h.avail_in||0===h.avail_out)&&r!==m.Z_STREAM_END);return r===m.Z_STREAM_END&&(n=m.Z_FINISH),n===m.Z_FINISH?(r=c.inflateEnd(this.strm),this.onEnd(r),this.ended=!0,r===m.Z_OK):n!==m.Z_SYNC_FLUSH||(this.onEnd(m.Z_OK),!(h.avail_out=0))},a.prototype.onData=function(e){this.chunks.push(e);},a.prototype.onEnd=function(e){e===m.Z_OK&&("string"===this.options.to?this.result=this.chunks.join(""):this.result=d.flattenChunks(this.chunks)),this.chunks=[],this.err=e,this.msg=this.strm.msg;},r.Inflate=a,r.inflate=o,r.inflateRaw=function(e,t){return (t=t||{}).raw=!0,o(e,t)},r.ungzip=o;},{"./utils/common":41,"./utils/strings":42,"./zlib/constants":44,"./zlib/gzheader":47,"./zlib/inflate":49,"./zlib/messages":51,"./zlib/zstream":53}],41:[function(e,t,r){var n="undefined"!=typeof Uint8Array&&"undefined"!=typeof Uint16Array&&"undefined"!=typeof Int32Array;r.assign=function(e){for(var t=Array.prototype.slice.call(arguments,1);t.length;){var r=t.shift();if(r){if("object"!=typeof r)throw new TypeError(r+"must be non-object");for(var n in r)r.hasOwnProperty(n)&&(e[n]=r[n]);}}return e},r.shrinkBuf=function(e,t){return e.length===t?e:e.subarray?e.subarray(0,t):(e.length=t,e)};var i={arraySet:function(e,t,r,n,i){if(t.subarray&&e.subarray)e.set(t.subarray(r,r+n),i);else for(var s=0;s<n;s++)e[i+s]=t[r+s];},flattenChunks:function(e){var t,r,n,i,s,a;for(t=n=0,r=e.length;t<r;t++)n+=e[t].length;for(a=new Uint8Array(n),t=i=0,r=e.length;t<r;t++)s=e[t],a.set(s,i),i+=s.length;return a}},s={arraySet:function(e,t,r,n,i){for(var s=0;s<n;s++)e[i+s]=t[r+s];},flattenChunks:function(e){return [].concat.apply([],e)}};r.setTyped=function(e){e?(r.Buf8=Uint8Array,r.Buf16=Uint16Array,r.Buf32=Int32Array,r.assign(r,i)):(r.Buf8=Array,r.Buf16=Array,r.Buf32=Array,r.assign(r,s));},r.setTyped(n);},{}],42:[function(e,t,r){var h=e("./common"),i=!0,s=!0;try{String.fromCharCode.apply(null,[0]);}catch(e){i=!1;}try{String.fromCharCode.apply(null,new Uint8Array(1));}catch(e){s=!1;}for(var u=new h.Buf8(256),n=0;n<256;n++)u[n]=252<=n?6:248<=n?5:240<=n?4:224<=n?3:192<=n?2:1;function l(e,t){if(t<65537&&(e.subarray&&s||!e.subarray&&i))return String.fromCharCode.apply(null,h.shrinkBuf(e,t));for(var r="",n=0;n<t;n++)r+=String.fromCharCode(e[n]);return r}u[254]=u[254]=1,r.string2buf=function(e){var t,r,n,i,s,a=e.length,o=0;for(i=0;i<a;i++)55296==(64512&(r=e.charCodeAt(i)))&&i+1<a&&56320==(64512&(n=e.charCodeAt(i+1)))&&(r=65536+(r-55296<<10)+(n-56320),i++),o+=r<128?1:r<2048?2:r<65536?3:4;for(t=new h.Buf8(o),i=s=0;s<o;i++)55296==(64512&(r=e.charCodeAt(i)))&&i+1<a&&56320==(64512&(n=e.charCodeAt(i+1)))&&(r=65536+(r-55296<<10)+(n-56320),i++),r<128?t[s++]=r:(r<2048?t[s++]=192|r>>>6:(r<65536?t[s++]=224|r>>>12:(t[s++]=240|r>>>18,t[s++]=128|r>>>12&63),t[s++]=128|r>>>6&63),t[s++]=128|63&r);return t},r.buf2binstring=function(e){return l(e,e.length)},r.binstring2buf=function(e){for(var t=new h.Buf8(e.length),r=0,n=t.length;r<n;r++)t[r]=e.charCodeAt(r);return t},r.buf2string=function(e,t){var r,n,i,s,a=t||e.length,o=new Array(2*a);for(r=n=0;r<a;)if((i=e[r++])<128)o[n++]=i;else if(4<(s=u[i]))o[n++]=65533,r+=s-1;else {for(i&=2===s?31:3===s?15:7;1<s&&r<a;)i=i<<6|63&e[r++],s--;1<s?o[n++]=65533:i<65536?o[n++]=i:(i-=65536,o[n++]=55296|i>>10&1023,o[n++]=56320|1023&i);}return l(o,n)},r.utf8border=function(e,t){var r;for((t=t||e.length)>e.length&&(t=e.length),r=t-1;0<=r&&128==(192&e[r]);)r--;return r<0?t:0===r?t:r+u[e[r]]>t?r:t};},{"./common":41}],43:[function(e,t,r){t.exports=function(e,t,r,n){for(var i=65535&e|0,s=e>>>16&65535|0,a=0;0!==r;){for(r-=a=2e3<r?2e3:r;s=s+(i=i+t[n++]|0)|0,--a;);i%=65521,s%=65521;}return i|s<<16|0};},{}],44:[function(e,t,r){t.exports={Z_NO_FLUSH:0,Z_PARTIAL_FLUSH:1,Z_SYNC_FLUSH:2,Z_FULL_FLUSH:3,Z_FINISH:4,Z_BLOCK:5,Z_TREES:6,Z_OK:0,Z_STREAM_END:1,Z_NEED_DICT:2,Z_ERRNO:-1,Z_STREAM_ERROR:-2,Z_DATA_ERROR:-3,Z_BUF_ERROR:-5,Z_NO_COMPRESSION:0,Z_BEST_SPEED:1,Z_BEST_COMPRESSION:9,Z_DEFAULT_COMPRESSION:-1,Z_FILTERED:1,Z_HUFFMAN_ONLY:2,Z_RLE:3,Z_FIXED:4,Z_DEFAULT_STRATEGY:0,Z_BINARY:0,Z_TEXT:1,Z_UNKNOWN:2,Z_DEFLATED:8};},{}],45:[function(e,t,r){var o=function(){for(var e,t=[],r=0;r<256;r++){e=r;for(var n=0;n<8;n++)e=1&e?3988292384^e>>>1:e>>>1;t[r]=e;}return t}();t.exports=function(e,t,r,n){var i=o,s=n+r;e^=-1;for(var a=n;a<s;a++)e=e>>>8^i[255&(e^t[a])];return -1^e};},{}],46:[function(e,t,r){var h,c=e("../utils/common"),u=e("./trees"),d=e("./adler32"),p=e("./crc32"),n=e("./messages"),l=0,f=4,m=0,_=-2,g=-1,b=4,i=2,v=8,y=9,s=286,a=30,o=19,w=2*s+1,k=15,x=3,S=258,z=S+x+1,C=42,E=113,A=1,I=2,O=3,B=4;function R(e,t){return e.msg=n[t],t}function T(e){return (e<<1)-(4<e?9:0)}function D(e){for(var t=e.length;0<=--t;)e[t]=0;}function F(e){var t=e.state,r=t.pending;r>e.avail_out&&(r=e.avail_out),0!==r&&(c.arraySet(e.output,t.pending_buf,t.pending_out,r,e.next_out),e.next_out+=r,t.pending_out+=r,e.total_out+=r,e.avail_out-=r,t.pending-=r,0===t.pending&&(t.pending_out=0));}function N(e,t){u._tr_flush_block(e,0<=e.block_start?e.block_start:-1,e.strstart-e.block_start,t),e.block_start=e.strstart,F(e.strm);}function U(e,t){e.pending_buf[e.pending++]=t;}function P(e,t){e.pending_buf[e.pending++]=t>>>8&255,e.pending_buf[e.pending++]=255&t;}function L(e,t){var r,n,i=e.max_chain_length,s=e.strstart,a=e.prev_length,o=e.nice_match,h=e.strstart>e.w_size-z?e.strstart-(e.w_size-z):0,u=e.window,l=e.w_mask,f=e.prev,c=e.strstart+S,d=u[s+a-1],p=u[s+a];e.prev_length>=e.good_match&&(i>>=2),o>e.lookahead&&(o=e.lookahead);do{if(u[(r=t)+a]===p&&u[r+a-1]===d&&u[r]===u[s]&&u[++r]===u[s+1]){s+=2,r++;do{}while(u[++s]===u[++r]&&u[++s]===u[++r]&&u[++s]===u[++r]&&u[++s]===u[++r]&&u[++s]===u[++r]&&u[++s]===u[++r]&&u[++s]===u[++r]&&u[++s]===u[++r]&&s<c);if(n=S-(c-s),s=c-S,a<n){if(e.match_start=t,o<=(a=n))break;d=u[s+a-1],p=u[s+a];}}}while((t=f[t&l])>h&&0!=--i);return a<=e.lookahead?a:e.lookahead}function j(e){var t,r,n,i,s,a,o,h,u,l,f=e.w_size;do{if(i=e.window_size-e.lookahead-e.strstart,e.strstart>=f+(f-z)){for(c.arraySet(e.window,e.window,f,f,0),e.match_start-=f,e.strstart-=f,e.block_start-=f,t=r=e.hash_size;n=e.head[--t],e.head[t]=f<=n?n-f:0,--r;);for(t=r=f;n=e.prev[--t],e.prev[t]=f<=n?n-f:0,--r;);i+=f;}if(0===e.strm.avail_in)break;if(a=e.strm,o=e.window,h=e.strstart+e.lookahead,u=i,l=void 0,l=a.avail_in,u<l&&(l=u),r=0===l?0:(a.avail_in-=l,c.arraySet(o,a.input,a.next_in,l,h),1===a.state.wrap?a.adler=d(a.adler,o,l,h):2===a.state.wrap&&(a.adler=p(a.adler,o,l,h)),a.next_in+=l,a.total_in+=l,l),e.lookahead+=r,e.lookahead+e.insert>=x)for(s=e.strstart-e.insert,e.ins_h=e.window[s],e.ins_h=(e.ins_h<<e.hash_shift^e.window[s+1])&e.hash_mask;e.insert&&(e.ins_h=(e.ins_h<<e.hash_shift^e.window[s+x-1])&e.hash_mask,e.prev[s&e.w_mask]=e.head[e.ins_h],e.head[e.ins_h]=s,s++,e.insert--,!(e.lookahead+e.insert<x)););}while(e.lookahead<z&&0!==e.strm.avail_in)}function Z(e,t){for(var r,n;;){if(e.lookahead<z){if(j(e),e.lookahead<z&&t===l)return A;if(0===e.lookahead)break}if(r=0,e.lookahead>=x&&(e.ins_h=(e.ins_h<<e.hash_shift^e.window[e.strstart+x-1])&e.hash_mask,r=e.prev[e.strstart&e.w_mask]=e.head[e.ins_h],e.head[e.ins_h]=e.strstart),0!==r&&e.strstart-r<=e.w_size-z&&(e.match_length=L(e,r)),e.match_length>=x)if(n=u._tr_tally(e,e.strstart-e.match_start,e.match_length-x),e.lookahead-=e.match_length,e.match_length<=e.max_lazy_match&&e.lookahead>=x){for(e.match_length--;e.strstart++,e.ins_h=(e.ins_h<<e.hash_shift^e.window[e.strstart+x-1])&e.hash_mask,r=e.prev[e.strstart&e.w_mask]=e.head[e.ins_h],e.head[e.ins_h]=e.strstart,0!=--e.match_length;);e.strstart++;}else e.strstart+=e.match_length,e.match_length=0,e.ins_h=e.window[e.strstart],e.ins_h=(e.ins_h<<e.hash_shift^e.window[e.strstart+1])&e.hash_mask;else n=u._tr_tally(e,0,e.window[e.strstart]),e.lookahead--,e.strstart++;if(n&&(N(e,!1),0===e.strm.avail_out))return A}return e.insert=e.strstart<x-1?e.strstart:x-1,t===f?(N(e,!0),0===e.strm.avail_out?O:B):e.last_lit&&(N(e,!1),0===e.strm.avail_out)?A:I}function W(e,t){for(var r,n,i;;){if(e.lookahead<z){if(j(e),e.lookahead<z&&t===l)return A;if(0===e.lookahead)break}if(r=0,e.lookahead>=x&&(e.ins_h=(e.ins_h<<e.hash_shift^e.window[e.strstart+x-1])&e.hash_mask,r=e.prev[e.strstart&e.w_mask]=e.head[e.ins_h],e.head[e.ins_h]=e.strstart),e.prev_length=e.match_length,e.prev_match=e.match_start,e.match_length=x-1,0!==r&&e.prev_length<e.max_lazy_match&&e.strstart-r<=e.w_size-z&&(e.match_length=L(e,r),e.match_length<=5&&(1===e.strategy||e.match_length===x&&4096<e.strstart-e.match_start)&&(e.match_length=x-1)),e.prev_length>=x&&e.match_length<=e.prev_length){for(i=e.strstart+e.lookahead-x,n=u._tr_tally(e,e.strstart-1-e.prev_match,e.prev_length-x),e.lookahead-=e.prev_length-1,e.prev_length-=2;++e.strstart<=i&&(e.ins_h=(e.ins_h<<e.hash_shift^e.window[e.strstart+x-1])&e.hash_mask,r=e.prev[e.strstart&e.w_mask]=e.head[e.ins_h],e.head[e.ins_h]=e.strstart),0!=--e.prev_length;);if(e.match_available=0,e.match_length=x-1,e.strstart++,n&&(N(e,!1),0===e.strm.avail_out))return A}else if(e.match_available){if((n=u._tr_tally(e,0,e.window[e.strstart-1]))&&N(e,!1),e.strstart++,e.lookahead--,0===e.strm.avail_out)return A}else e.match_available=1,e.strstart++,e.lookahead--;}return e.match_available&&(n=u._tr_tally(e,0,e.window[e.strstart-1]),e.match_available=0),e.insert=e.strstart<x-1?e.strstart:x-1,t===f?(N(e,!0),0===e.strm.avail_out?O:B):e.last_lit&&(N(e,!1),0===e.strm.avail_out)?A:I}function M(e,t,r,n,i){this.good_length=e,this.max_lazy=t,this.nice_length=r,this.max_chain=n,this.func=i;}function H(){this.strm=null,this.status=0,this.pending_buf=null,this.pending_buf_size=0,this.pending_out=0,this.pending=0,this.wrap=0,this.gzhead=null,this.gzindex=0,this.method=v,this.last_flush=-1,this.w_size=0,this.w_bits=0,this.w_mask=0,this.window=null,this.window_size=0,this.prev=null,this.head=null,this.ins_h=0,this.hash_size=0,this.hash_bits=0,this.hash_mask=0,this.hash_shift=0,this.block_start=0,this.match_length=0,this.prev_match=0,this.match_available=0,this.strstart=0,this.match_start=0,this.lookahead=0,this.prev_length=0,this.max_chain_length=0,this.max_lazy_match=0,this.level=0,this.strategy=0,this.good_match=0,this.nice_match=0,this.dyn_ltree=new c.Buf16(2*w),this.dyn_dtree=new c.Buf16(2*(2*a+1)),this.bl_tree=new c.Buf16(2*(2*o+1)),D(this.dyn_ltree),D(this.dyn_dtree),D(this.bl_tree),this.l_desc=null,this.d_desc=null,this.bl_desc=null,this.bl_count=new c.Buf16(k+1),this.heap=new c.Buf16(2*s+1),D(this.heap),this.heap_len=0,this.heap_max=0,this.depth=new c.Buf16(2*s+1),D(this.depth),this.l_buf=0,this.lit_bufsize=0,this.last_lit=0,this.d_buf=0,this.opt_len=0,this.static_len=0,this.matches=0,this.insert=0,this.bi_buf=0,this.bi_valid=0;}function G(e){var t;return e&&e.state?(e.total_in=e.total_out=0,e.data_type=i,(t=e.state).pending=0,t.pending_out=0,t.wrap<0&&(t.wrap=-t.wrap),t.status=t.wrap?C:E,e.adler=2===t.wrap?0:1,t.last_flush=l,u._tr_init(t),m):R(e,_)}function K(e){var t=G(e);return t===m&&function(e){e.window_size=2*e.w_size,D(e.head),e.max_lazy_match=h[e.level].max_lazy,e.good_match=h[e.level].good_length,e.nice_match=h[e.level].nice_length,e.max_chain_length=h[e.level].max_chain,e.strstart=0,e.block_start=0,e.lookahead=0,e.insert=0,e.match_length=e.prev_length=x-1,e.match_available=0,e.ins_h=0;}(e.state),t}function Y(e,t,r,n,i,s){if(!e)return _;var a=1;if(t===g&&(t=6),n<0?(a=0,n=-n):15<n&&(a=2,n-=16),i<1||y<i||r!==v||n<8||15<n||t<0||9<t||s<0||b<s)return R(e,_);8===n&&(n=9);var o=new H;return (e.state=o).strm=e,o.wrap=a,o.gzhead=null,o.w_bits=n,o.w_size=1<<o.w_bits,o.w_mask=o.w_size-1,o.hash_bits=i+7,o.hash_size=1<<o.hash_bits,o.hash_mask=o.hash_size-1,o.hash_shift=~~((o.hash_bits+x-1)/x),o.window=new c.Buf8(2*o.w_size),o.head=new c.Buf16(o.hash_size),o.prev=new c.Buf16(o.w_size),o.lit_bufsize=1<<i+6,o.pending_buf_size=4*o.lit_bufsize,o.pending_buf=new c.Buf8(o.pending_buf_size),o.d_buf=1*o.lit_bufsize,o.l_buf=3*o.lit_bufsize,o.level=t,o.strategy=s,o.method=r,K(e)}h=[new M(0,0,0,0,function(e,t){var r=65535;for(r>e.pending_buf_size-5&&(r=e.pending_buf_size-5);;){if(e.lookahead<=1){if(j(e),0===e.lookahead&&t===l)return A;if(0===e.lookahead)break}e.strstart+=e.lookahead,e.lookahead=0;var n=e.block_start+r;if((0===e.strstart||e.strstart>=n)&&(e.lookahead=e.strstart-n,e.strstart=n,N(e,!1),0===e.strm.avail_out))return A;if(e.strstart-e.block_start>=e.w_size-z&&(N(e,!1),0===e.strm.avail_out))return A}return e.insert=0,t===f?(N(e,!0),0===e.strm.avail_out?O:B):(e.strstart>e.block_start&&(N(e,!1),e.strm.avail_out),A)}),new M(4,4,8,4,Z),new M(4,5,16,8,Z),new M(4,6,32,32,Z),new M(4,4,16,16,W),new M(8,16,32,32,W),new M(8,16,128,128,W),new M(8,32,128,256,W),new M(32,128,258,1024,W),new M(32,258,258,4096,W)],r.deflateInit=function(e,t){return Y(e,t,v,15,8,0)},r.deflateInit2=Y,r.deflateReset=K,r.deflateResetKeep=G,r.deflateSetHeader=function(e,t){return e&&e.state?2!==e.state.wrap?_:(e.state.gzhead=t,m):_},r.deflate=function(e,t){var r,n,i,s;if(!e||!e.state||5<t||t<0)return e?R(e,_):_;if(n=e.state,!e.output||!e.input&&0!==e.avail_in||666===n.status&&t!==f)return R(e,0===e.avail_out?-5:_);if(n.strm=e,r=n.last_flush,n.last_flush=t,n.status===C)if(2===n.wrap)e.adler=0,U(n,31),U(n,139),U(n,8),n.gzhead?(U(n,(n.gzhead.text?1:0)+(n.gzhead.hcrc?2:0)+(n.gzhead.extra?4:0)+(n.gzhead.name?8:0)+(n.gzhead.comment?16:0)),U(n,255&n.gzhead.time),U(n,n.gzhead.time>>8&255),U(n,n.gzhead.time>>16&255),U(n,n.gzhead.time>>24&255),U(n,9===n.level?2:2<=n.strategy||n.level<2?4:0),U(n,255&n.gzhead.os),n.gzhead.extra&&n.gzhead.extra.length&&(U(n,255&n.gzhead.extra.length),U(n,n.gzhead.extra.length>>8&255)),n.gzhead.hcrc&&(e.adler=p(e.adler,n.pending_buf,n.pending,0)),n.gzindex=0,n.status=69):(U(n,0),U(n,0),U(n,0),U(n,0),U(n,0),U(n,9===n.level?2:2<=n.strategy||n.level<2?4:0),U(n,3),n.status=E);else {var a=v+(n.w_bits-8<<4)<<8;a|=(2<=n.strategy||n.level<2?0:n.level<6?1:6===n.level?2:3)<<6,0!==n.strstart&&(a|=32),a+=31-a%31,n.status=E,P(n,a),0!==n.strstart&&(P(n,e.adler>>>16),P(n,65535&e.adler)),e.adler=1;}if(69===n.status)if(n.gzhead.extra){for(i=n.pending;n.gzindex<(65535&n.gzhead.extra.length)&&(n.pending!==n.pending_buf_size||(n.gzhead.hcrc&&n.pending>i&&(e.adler=p(e.adler,n.pending_buf,n.pending-i,i)),F(e),i=n.pending,n.pending!==n.pending_buf_size));)U(n,255&n.gzhead.extra[n.gzindex]),n.gzindex++;n.gzhead.hcrc&&n.pending>i&&(e.adler=p(e.adler,n.pending_buf,n.pending-i,i)),n.gzindex===n.gzhead.extra.length&&(n.gzindex=0,n.status=73);}else n.status=73;if(73===n.status)if(n.gzhead.name){i=n.pending;do{if(n.pending===n.pending_buf_size&&(n.gzhead.hcrc&&n.pending>i&&(e.adler=p(e.adler,n.pending_buf,n.pending-i,i)),F(e),i=n.pending,n.pending===n.pending_buf_size)){s=1;break}s=n.gzindex<n.gzhead.name.length?255&n.gzhead.name.charCodeAt(n.gzindex++):0,U(n,s);}while(0!==s);n.gzhead.hcrc&&n.pending>i&&(e.adler=p(e.adler,n.pending_buf,n.pending-i,i)),0===s&&(n.gzindex=0,n.status=91);}else n.status=91;if(91===n.status)if(n.gzhead.comment){i=n.pending;do{if(n.pending===n.pending_buf_size&&(n.gzhead.hcrc&&n.pending>i&&(e.adler=p(e.adler,n.pending_buf,n.pending-i,i)),F(e),i=n.pending,n.pending===n.pending_buf_size)){s=1;break}s=n.gzindex<n.gzhead.comment.length?255&n.gzhead.comment.charCodeAt(n.gzindex++):0,U(n,s);}while(0!==s);n.gzhead.hcrc&&n.pending>i&&(e.adler=p(e.adler,n.pending_buf,n.pending-i,i)),0===s&&(n.status=103);}else n.status=103;if(103===n.status&&(n.gzhead.hcrc?(n.pending+2>n.pending_buf_size&&F(e),n.pending+2<=n.pending_buf_size&&(U(n,255&e.adler),U(n,e.adler>>8&255),e.adler=0,n.status=E)):n.status=E),0!==n.pending){if(F(e),0===e.avail_out)return n.last_flush=-1,m}else if(0===e.avail_in&&T(t)<=T(r)&&t!==f)return R(e,-5);if(666===n.status&&0!==e.avail_in)return R(e,-5);if(0!==e.avail_in||0!==n.lookahead||t!==l&&666!==n.status){var o=2===n.strategy?function(e,t){for(var r;;){if(0===e.lookahead&&(j(e),0===e.lookahead)){if(t===l)return A;break}if(e.match_length=0,r=u._tr_tally(e,0,e.window[e.strstart]),e.lookahead--,e.strstart++,r&&(N(e,!1),0===e.strm.avail_out))return A}return e.insert=0,t===f?(N(e,!0),0===e.strm.avail_out?O:B):e.last_lit&&(N(e,!1),0===e.strm.avail_out)?A:I}(n,t):3===n.strategy?function(e,t){for(var r,n,i,s,a=e.window;;){if(e.lookahead<=S){if(j(e),e.lookahead<=S&&t===l)return A;if(0===e.lookahead)break}if(e.match_length=0,e.lookahead>=x&&0<e.strstart&&(n=a[i=e.strstart-1])===a[++i]&&n===a[++i]&&n===a[++i]){s=e.strstart+S;do{}while(n===a[++i]&&n===a[++i]&&n===a[++i]&&n===a[++i]&&n===a[++i]&&n===a[++i]&&n===a[++i]&&n===a[++i]&&i<s);e.match_length=S-(s-i),e.match_length>e.lookahead&&(e.match_length=e.lookahead);}if(e.match_length>=x?(r=u._tr_tally(e,1,e.match_length-x),e.lookahead-=e.match_length,e.strstart+=e.match_length,e.match_length=0):(r=u._tr_tally(e,0,e.window[e.strstart]),e.lookahead--,e.strstart++),r&&(N(e,!1),0===e.strm.avail_out))return A}return e.insert=0,t===f?(N(e,!0),0===e.strm.avail_out?O:B):e.last_lit&&(N(e,!1),0===e.strm.avail_out)?A:I}(n,t):h[n.level].func(n,t);if(o!==O&&o!==B||(n.status=666),o===A||o===O)return 0===e.avail_out&&(n.last_flush=-1),m;if(o===I&&(1===t?u._tr_align(n):5!==t&&(u._tr_stored_block(n,0,0,!1),3===t&&(D(n.head),0===n.lookahead&&(n.strstart=0,n.block_start=0,n.insert=0))),F(e),0===e.avail_out))return n.last_flush=-1,m}return t!==f?m:n.wrap<=0?1:(2===n.wrap?(U(n,255&e.adler),U(n,e.adler>>8&255),U(n,e.adler>>16&255),U(n,e.adler>>24&255),U(n,255&e.total_in),U(n,e.total_in>>8&255),U(n,e.total_in>>16&255),U(n,e.total_in>>24&255)):(P(n,e.adler>>>16),P(n,65535&e.adler)),F(e),0<n.wrap&&(n.wrap=-n.wrap),0!==n.pending?m:1)},r.deflateEnd=function(e){var t;return e&&e.state?(t=e.state.status)!==C&&69!==t&&73!==t&&91!==t&&103!==t&&t!==E&&666!==t?R(e,_):(e.state=null,t===E?R(e,-3):m):_},r.deflateSetDictionary=function(e,t){var r,n,i,s,a,o,h,u,l=t.length;if(!e||!e.state)return _;if(2===(s=(r=e.state).wrap)||1===s&&r.status!==C||r.lookahead)return _;for(1===s&&(e.adler=d(e.adler,t,l,0)),r.wrap=0,l>=r.w_size&&(0===s&&(D(r.head),r.strstart=0,r.block_start=0,r.insert=0),u=new c.Buf8(r.w_size),c.arraySet(u,t,l-r.w_size,r.w_size,0),t=u,l=r.w_size),a=e.avail_in,o=e.next_in,h=e.input,e.avail_in=l,e.next_in=0,e.input=t,j(r);r.lookahead>=x;){for(n=r.strstart,i=r.lookahead-(x-1);r.ins_h=(r.ins_h<<r.hash_shift^r.window[n+x-1])&r.hash_mask,r.prev[n&r.w_mask]=r.head[r.ins_h],r.head[r.ins_h]=n,n++,--i;);r.strstart=n,r.lookahead=x-1,j(r);}return r.strstart+=r.lookahead,r.block_start=r.strstart,r.insert=r.lookahead,r.lookahead=0,r.match_length=r.prev_length=x-1,r.match_available=0,e.next_in=o,e.input=h,e.avail_in=a,r.wrap=s,m},r.deflateInfo="pako deflate (from Nodeca project)";},{"../utils/common":41,"./adler32":43,"./crc32":45,"./messages":51,"./trees":52}],47:[function(e,t,r){t.exports=function(){this.text=0,this.time=0,this.xflags=0,this.os=0,this.extra=null,this.extra_len=0,this.name="",this.comment="",this.hcrc=0,this.done=!1;};},{}],48:[function(e,t,r){t.exports=function(e,t){var r,n,i,s,a,o,h,u,l,f,c,d,p,m,_,g,b,v,y,w,k,x,S,z,C;r=e.state,n=e.next_in,z=e.input,i=n+(e.avail_in-5),s=e.next_out,C=e.output,a=s-(t-e.avail_out),o=s+(e.avail_out-257),h=r.dmax,u=r.wsize,l=r.whave,f=r.wnext,c=r.window,d=r.hold,p=r.bits,m=r.lencode,_=r.distcode,g=(1<<r.lenbits)-1,b=(1<<r.distbits)-1;e:do{p<15&&(d+=z[n++]<<p,p+=8,d+=z[n++]<<p,p+=8),v=m[d&g];t:for(;;){if(d>>>=y=v>>>24,p-=y,0===(y=v>>>16&255))C[s++]=65535&v;else {if(!(16&y)){if(0==(64&y)){v=m[(65535&v)+(d&(1<<y)-1)];continue t}if(32&y){r.mode=12;break e}e.msg="invalid literal/length code",r.mode=30;break e}w=65535&v,(y&=15)&&(p<y&&(d+=z[n++]<<p,p+=8),w+=d&(1<<y)-1,d>>>=y,p-=y),p<15&&(d+=z[n++]<<p,p+=8,d+=z[n++]<<p,p+=8),v=_[d&b];r:for(;;){if(d>>>=y=v>>>24,p-=y,!(16&(y=v>>>16&255))){if(0==(64&y)){v=_[(65535&v)+(d&(1<<y)-1)];continue r}e.msg="invalid distance code",r.mode=30;break e}if(k=65535&v,p<(y&=15)&&(d+=z[n++]<<p,(p+=8)<y&&(d+=z[n++]<<p,p+=8)),h<(k+=d&(1<<y)-1)){e.msg="invalid distance too far back",r.mode=30;break e}if(d>>>=y,p-=y,(y=s-a)<k){if(l<(y=k-y)&&r.sane){e.msg="invalid distance too far back",r.mode=30;break e}if(S=c,(x=0)===f){if(x+=u-y,y<w){for(w-=y;C[s++]=c[x++],--y;);x=s-k,S=C;}}else if(f<y){if(x+=u+f-y,(y-=f)<w){for(w-=y;C[s++]=c[x++],--y;);if(x=0,f<w){for(w-=y=f;C[s++]=c[x++],--y;);x=s-k,S=C;}}}else if(x+=f-y,y<w){for(w-=y;C[s++]=c[x++],--y;);x=s-k,S=C;}for(;2<w;)C[s++]=S[x++],C[s++]=S[x++],C[s++]=S[x++],w-=3;w&&(C[s++]=S[x++],1<w&&(C[s++]=S[x++]));}else {for(x=s-k;C[s++]=C[x++],C[s++]=C[x++],C[s++]=C[x++],2<(w-=3););w&&(C[s++]=C[x++],1<w&&(C[s++]=C[x++]));}break}}break}}while(n<i&&s<o);n-=w=p>>3,d&=(1<<(p-=w<<3))-1,e.next_in=n,e.next_out=s,e.avail_in=n<i?i-n+5:5-(n-i),e.avail_out=s<o?o-s+257:257-(s-o),r.hold=d,r.bits=p;};},{}],49:[function(e,t,r){var I=e("../utils/common"),O=e("./adler32"),B=e("./crc32"),R=e("./inffast"),T=e("./inftrees"),D=1,F=2,N=0,U=-2,P=1,n=852,i=592;function L(e){return (e>>>24&255)+(e>>>8&65280)+((65280&e)<<8)+((255&e)<<24)}function s(){this.mode=0,this.last=!1,this.wrap=0,this.havedict=!1,this.flags=0,this.dmax=0,this.check=0,this.total=0,this.head=null,this.wbits=0,this.wsize=0,this.whave=0,this.wnext=0,this.window=null,this.hold=0,this.bits=0,this.length=0,this.offset=0,this.extra=0,this.lencode=null,this.distcode=null,this.lenbits=0,this.distbits=0,this.ncode=0,this.nlen=0,this.ndist=0,this.have=0,this.next=null,this.lens=new I.Buf16(320),this.work=new I.Buf16(288),this.lendyn=null,this.distdyn=null,this.sane=0,this.back=0,this.was=0;}function a(e){var t;return e&&e.state?(t=e.state,e.total_in=e.total_out=t.total=0,e.msg="",t.wrap&&(e.adler=1&t.wrap),t.mode=P,t.last=0,t.havedict=0,t.dmax=32768,t.head=null,t.hold=0,t.bits=0,t.lencode=t.lendyn=new I.Buf32(n),t.distcode=t.distdyn=new I.Buf32(i),t.sane=1,t.back=-1,N):U}function o(e){var t;return e&&e.state?((t=e.state).wsize=0,t.whave=0,t.wnext=0,a(e)):U}function h(e,t){var r,n;return e&&e.state?(n=e.state,t<0?(r=0,t=-t):(r=1+(t>>4),t<48&&(t&=15)),t&&(t<8||15<t)?U:(null!==n.window&&n.wbits!==t&&(n.window=null),n.wrap=r,n.wbits=t,o(e))):U}function u(e,t){var r,n;return e?(n=new s,(e.state=n).window=null,(r=h(e,t))!==N&&(e.state=null),r):U}var l,f,c=!0;function j(e){if(c){var t;for(l=new I.Buf32(512),f=new I.Buf32(32),t=0;t<144;)e.lens[t++]=8;for(;t<256;)e.lens[t++]=9;for(;t<280;)e.lens[t++]=7;for(;t<288;)e.lens[t++]=8;for(T(D,e.lens,0,288,l,0,e.work,{bits:9}),t=0;t<32;)e.lens[t++]=5;T(F,e.lens,0,32,f,0,e.work,{bits:5}),c=!1;}e.lencode=l,e.lenbits=9,e.distcode=f,e.distbits=5;}function Z(e,t,r,n){var i,s=e.state;return null===s.window&&(s.wsize=1<<s.wbits,s.wnext=0,s.whave=0,s.window=new I.Buf8(s.wsize)),n>=s.wsize?(I.arraySet(s.window,t,r-s.wsize,s.wsize,0),s.wnext=0,s.whave=s.wsize):(n<(i=s.wsize-s.wnext)&&(i=n),I.arraySet(s.window,t,r-n,i,s.wnext),(n-=i)?(I.arraySet(s.window,t,r-n,n,0),s.wnext=n,s.whave=s.wsize):(s.wnext+=i,s.wnext===s.wsize&&(s.wnext=0),s.whave<s.wsize&&(s.whave+=i))),0}r.inflateReset=o,r.inflateReset2=h,r.inflateResetKeep=a,r.inflateInit=function(e){return u(e,15)},r.inflateInit2=u,r.inflate=function(e,t){var r,n,i,s,a,o,h,u,l,f,c,d,p,m,_,g,b,v,y,w,k,x,S,z,C=0,E=new I.Buf8(4),A=[16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];if(!e||!e.state||!e.output||!e.input&&0!==e.avail_in)return U;12===(r=e.state).mode&&(r.mode=13),a=e.next_out,i=e.output,h=e.avail_out,s=e.next_in,n=e.input,o=e.avail_in,u=r.hold,l=r.bits,f=o,c=h,x=N;e:for(;;)switch(r.mode){case P:if(0===r.wrap){r.mode=13;break}for(;l<16;){if(0===o)break e;o--,u+=n[s++]<<l,l+=8;}if(2&r.wrap&&35615===u){E[r.check=0]=255&u,E[1]=u>>>8&255,r.check=B(r.check,E,2,0),l=u=0,r.mode=2;break}if(r.flags=0,r.head&&(r.head.done=!1),!(1&r.wrap)||(((255&u)<<8)+(u>>8))%31){e.msg="incorrect header check",r.mode=30;break}if(8!=(15&u)){e.msg="unknown compression method",r.mode=30;break}if(l-=4,k=8+(15&(u>>>=4)),0===r.wbits)r.wbits=k;else if(k>r.wbits){e.msg="invalid window size",r.mode=30;break}r.dmax=1<<k,e.adler=r.check=1,r.mode=512&u?10:12,l=u=0;break;case 2:for(;l<16;){if(0===o)break e;o--,u+=n[s++]<<l,l+=8;}if(r.flags=u,8!=(255&r.flags)){e.msg="unknown compression method",r.mode=30;break}if(57344&r.flags){e.msg="unknown header flags set",r.mode=30;break}r.head&&(r.head.text=u>>8&1),512&r.flags&&(E[0]=255&u,E[1]=u>>>8&255,r.check=B(r.check,E,2,0)),l=u=0,r.mode=3;case 3:for(;l<32;){if(0===o)break e;o--,u+=n[s++]<<l,l+=8;}r.head&&(r.head.time=u),512&r.flags&&(E[0]=255&u,E[1]=u>>>8&255,E[2]=u>>>16&255,E[3]=u>>>24&255,r.check=B(r.check,E,4,0)),l=u=0,r.mode=4;case 4:for(;l<16;){if(0===o)break e;o--,u+=n[s++]<<l,l+=8;}r.head&&(r.head.xflags=255&u,r.head.os=u>>8),512&r.flags&&(E[0]=255&u,E[1]=u>>>8&255,r.check=B(r.check,E,2,0)),l=u=0,r.mode=5;case 5:if(1024&r.flags){for(;l<16;){if(0===o)break e;o--,u+=n[s++]<<l,l+=8;}r.length=u,r.head&&(r.head.extra_len=u),512&r.flags&&(E[0]=255&u,E[1]=u>>>8&255,r.check=B(r.check,E,2,0)),l=u=0;}else r.head&&(r.head.extra=null);r.mode=6;case 6:if(1024&r.flags&&(o<(d=r.length)&&(d=o),d&&(r.head&&(k=r.head.extra_len-r.length,r.head.extra||(r.head.extra=new Array(r.head.extra_len)),I.arraySet(r.head.extra,n,s,d,k)),512&r.flags&&(r.check=B(r.check,n,d,s)),o-=d,s+=d,r.length-=d),r.length))break e;r.length=0,r.mode=7;case 7:if(2048&r.flags){if(0===o)break e;for(d=0;k=n[s+d++],r.head&&k&&r.length<65536&&(r.head.name+=String.fromCharCode(k)),k&&d<o;);if(512&r.flags&&(r.check=B(r.check,n,d,s)),o-=d,s+=d,k)break e}else r.head&&(r.head.name=null);r.length=0,r.mode=8;case 8:if(4096&r.flags){if(0===o)break e;for(d=0;k=n[s+d++],r.head&&k&&r.length<65536&&(r.head.comment+=String.fromCharCode(k)),k&&d<o;);if(512&r.flags&&(r.check=B(r.check,n,d,s)),o-=d,s+=d,k)break e}else r.head&&(r.head.comment=null);r.mode=9;case 9:if(512&r.flags){for(;l<16;){if(0===o)break e;o--,u+=n[s++]<<l,l+=8;}if(u!==(65535&r.check)){e.msg="header crc mismatch",r.mode=30;break}l=u=0;}r.head&&(r.head.hcrc=r.flags>>9&1,r.head.done=!0),e.adler=r.check=0,r.mode=12;break;case 10:for(;l<32;){if(0===o)break e;o--,u+=n[s++]<<l,l+=8;}e.adler=r.check=L(u),l=u=0,r.mode=11;case 11:if(0===r.havedict)return e.next_out=a,e.avail_out=h,e.next_in=s,e.avail_in=o,r.hold=u,r.bits=l,2;e.adler=r.check=1,r.mode=12;case 12:if(5===t||6===t)break e;case 13:if(r.last){u>>>=7&l,l-=7&l,r.mode=27;break}for(;l<3;){if(0===o)break e;o--,u+=n[s++]<<l,l+=8;}switch(r.last=1&u,l-=1,3&(u>>>=1)){case 0:r.mode=14;break;case 1:if(j(r),r.mode=20,6!==t)break;u>>>=2,l-=2;break e;case 2:r.mode=17;break;case 3:e.msg="invalid block type",r.mode=30;}u>>>=2,l-=2;break;case 14:for(u>>>=7&l,l-=7&l;l<32;){if(0===o)break e;o--,u+=n[s++]<<l,l+=8;}if((65535&u)!=(u>>>16^65535)){e.msg="invalid stored block lengths",r.mode=30;break}if(r.length=65535&u,l=u=0,r.mode=15,6===t)break e;case 15:r.mode=16;case 16:if(d=r.length){if(o<d&&(d=o),h<d&&(d=h),0===d)break e;I.arraySet(i,n,s,d,a),o-=d,s+=d,h-=d,a+=d,r.length-=d;break}r.mode=12;break;case 17:for(;l<14;){if(0===o)break e;o--,u+=n[s++]<<l,l+=8;}if(r.nlen=257+(31&u),u>>>=5,l-=5,r.ndist=1+(31&u),u>>>=5,l-=5,r.ncode=4+(15&u),u>>>=4,l-=4,286<r.nlen||30<r.ndist){e.msg="too many length or distance symbols",r.mode=30;break}r.have=0,r.mode=18;case 18:for(;r.have<r.ncode;){for(;l<3;){if(0===o)break e;o--,u+=n[s++]<<l,l+=8;}r.lens[A[r.have++]]=7&u,u>>>=3,l-=3;}for(;r.have<19;)r.lens[A[r.have++]]=0;if(r.lencode=r.lendyn,r.lenbits=7,S={bits:r.lenbits},x=T(0,r.lens,0,19,r.lencode,0,r.work,S),r.lenbits=S.bits,x){e.msg="invalid code lengths set",r.mode=30;break}r.have=0,r.mode=19;case 19:for(;r.have<r.nlen+r.ndist;){for(;g=(C=r.lencode[u&(1<<r.lenbits)-1])>>>16&255,b=65535&C,!((_=C>>>24)<=l);){if(0===o)break e;o--,u+=n[s++]<<l,l+=8;}if(b<16)u>>>=_,l-=_,r.lens[r.have++]=b;else {if(16===b){for(z=_+2;l<z;){if(0===o)break e;o--,u+=n[s++]<<l,l+=8;}if(u>>>=_,l-=_,0===r.have){e.msg="invalid bit length repeat",r.mode=30;break}k=r.lens[r.have-1],d=3+(3&u),u>>>=2,l-=2;}else if(17===b){for(z=_+3;l<z;){if(0===o)break e;o--,u+=n[s++]<<l,l+=8;}l-=_,k=0,d=3+(7&(u>>>=_)),u>>>=3,l-=3;}else {for(z=_+7;l<z;){if(0===o)break e;o--,u+=n[s++]<<l,l+=8;}l-=_,k=0,d=11+(127&(u>>>=_)),u>>>=7,l-=7;}if(r.have+d>r.nlen+r.ndist){e.msg="invalid bit length repeat",r.mode=30;break}for(;d--;)r.lens[r.have++]=k;}}if(30===r.mode)break;if(0===r.lens[256]){e.msg="invalid code -- missing end-of-block",r.mode=30;break}if(r.lenbits=9,S={bits:r.lenbits},x=T(D,r.lens,0,r.nlen,r.lencode,0,r.work,S),r.lenbits=S.bits,x){e.msg="invalid literal/lengths set",r.mode=30;break}if(r.distbits=6,r.distcode=r.distdyn,S={bits:r.distbits},x=T(F,r.lens,r.nlen,r.ndist,r.distcode,0,r.work,S),r.distbits=S.bits,x){e.msg="invalid distances set",r.mode=30;break}if(r.mode=20,6===t)break e;case 20:r.mode=21;case 21:if(6<=o&&258<=h){e.next_out=a,e.avail_out=h,e.next_in=s,e.avail_in=o,r.hold=u,r.bits=l,R(e,c),a=e.next_out,i=e.output,h=e.avail_out,s=e.next_in,n=e.input,o=e.avail_in,u=r.hold,l=r.bits,12===r.mode&&(r.back=-1);break}for(r.back=0;g=(C=r.lencode[u&(1<<r.lenbits)-1])>>>16&255,b=65535&C,!((_=C>>>24)<=l);){if(0===o)break e;o--,u+=n[s++]<<l,l+=8;}if(g&&0==(240&g)){for(v=_,y=g,w=b;g=(C=r.lencode[w+((u&(1<<v+y)-1)>>v)])>>>16&255,b=65535&C,!(v+(_=C>>>24)<=l);){if(0===o)break e;o--,u+=n[s++]<<l,l+=8;}u>>>=v,l-=v,r.back+=v;}if(u>>>=_,l-=_,r.back+=_,r.length=b,0===g){r.mode=26;break}if(32&g){r.back=-1,r.mode=12;break}if(64&g){e.msg="invalid literal/length code",r.mode=30;break}r.extra=15&g,r.mode=22;case 22:if(r.extra){for(z=r.extra;l<z;){if(0===o)break e;o--,u+=n[s++]<<l,l+=8;}r.length+=u&(1<<r.extra)-1,u>>>=r.extra,l-=r.extra,r.back+=r.extra;}r.was=r.length,r.mode=23;case 23:for(;g=(C=r.distcode[u&(1<<r.distbits)-1])>>>16&255,b=65535&C,!((_=C>>>24)<=l);){if(0===o)break e;o--,u+=n[s++]<<l,l+=8;}if(0==(240&g)){for(v=_,y=g,w=b;g=(C=r.distcode[w+((u&(1<<v+y)-1)>>v)])>>>16&255,b=65535&C,!(v+(_=C>>>24)<=l);){if(0===o)break e;o--,u+=n[s++]<<l,l+=8;}u>>>=v,l-=v,r.back+=v;}if(u>>>=_,l-=_,r.back+=_,64&g){e.msg="invalid distance code",r.mode=30;break}r.offset=b,r.extra=15&g,r.mode=24;case 24:if(r.extra){for(z=r.extra;l<z;){if(0===o)break e;o--,u+=n[s++]<<l,l+=8;}r.offset+=u&(1<<r.extra)-1,u>>>=r.extra,l-=r.extra,r.back+=r.extra;}if(r.offset>r.dmax){e.msg="invalid distance too far back",r.mode=30;break}r.mode=25;case 25:if(0===h)break e;if(d=c-h,r.offset>d){if((d=r.offset-d)>r.whave&&r.sane){e.msg="invalid distance too far back",r.mode=30;break}p=d>r.wnext?(d-=r.wnext,r.wsize-d):r.wnext-d,d>r.length&&(d=r.length),m=r.window;}else m=i,p=a-r.offset,d=r.length;for(h<d&&(d=h),h-=d,r.length-=d;i[a++]=m[p++],--d;);0===r.length&&(r.mode=21);break;case 26:if(0===h)break e;i[a++]=r.length,h--,r.mode=21;break;case 27:if(r.wrap){for(;l<32;){if(0===o)break e;o--,u|=n[s++]<<l,l+=8;}if(c-=h,e.total_out+=c,r.total+=c,c&&(e.adler=r.check=r.flags?B(r.check,i,c,a-c):O(r.check,i,c,a-c)),c=h,(r.flags?u:L(u))!==r.check){e.msg="incorrect data check",r.mode=30;break}l=u=0;}r.mode=28;case 28:if(r.wrap&&r.flags){for(;l<32;){if(0===o)break e;o--,u+=n[s++]<<l,l+=8;}if(u!==(4294967295&r.total)){e.msg="incorrect length check",r.mode=30;break}l=u=0;}r.mode=29;case 29:x=1;break e;case 30:x=-3;break e;case 31:return -4;case 32:default:return U}return e.next_out=a,e.avail_out=h,e.next_in=s,e.avail_in=o,r.hold=u,r.bits=l,(r.wsize||c!==e.avail_out&&r.mode<30&&(r.mode<27||4!==t))&&Z(e,e.output,e.next_out,c-e.avail_out)?(r.mode=31,-4):(f-=e.avail_in,c-=e.avail_out,e.total_in+=f,e.total_out+=c,r.total+=c,r.wrap&&c&&(e.adler=r.check=r.flags?B(r.check,i,c,e.next_out-c):O(r.check,i,c,e.next_out-c)),e.data_type=r.bits+(r.last?64:0)+(12===r.mode?128:0)+(20===r.mode||15===r.mode?256:0),(0==f&&0===c||4===t)&&x===N&&(x=-5),x)},r.inflateEnd=function(e){if(!e||!e.state)return U;var t=e.state;return t.window&&(t.window=null),e.state=null,N},r.inflateGetHeader=function(e,t){var r;return e&&e.state?0==(2&(r=e.state).wrap)?U:((r.head=t).done=!1,N):U},r.inflateSetDictionary=function(e,t){var r,n=t.length;return e&&e.state?0!==(r=e.state).wrap&&11!==r.mode?U:11===r.mode&&O(1,t,n,0)!==r.check?-3:Z(e,t,n,n)?(r.mode=31,-4):(r.havedict=1,N):U},r.inflateInfo="pako inflate (from Nodeca project)";},{"../utils/common":41,"./adler32":43,"./crc32":45,"./inffast":48,"./inftrees":50}],50:[function(e,t,r){var D=e("../utils/common"),F=[3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258,0,0],N=[16,16,16,16,16,16,16,16,17,17,17,17,18,18,18,18,19,19,19,19,20,20,20,20,21,21,21,21,16,72,78],U=[1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577,0,0],P=[16,16,16,16,17,17,18,18,19,19,20,20,21,21,22,22,23,23,24,24,25,25,26,26,27,27,28,28,29,29,64,64];t.exports=function(e,t,r,n,i,s,a,o){var h,u,l,f,c,d,p,m,_,g=o.bits,b=0,v=0,y=0,w=0,k=0,x=0,S=0,z=0,C=0,E=0,A=null,I=0,O=new D.Buf16(16),B=new D.Buf16(16),R=null,T=0;for(b=0;b<=15;b++)O[b]=0;for(v=0;v<n;v++)O[t[r+v]]++;for(k=g,w=15;1<=w&&0===O[w];w--);if(w<k&&(k=w),0===w)return i[s++]=20971520,i[s++]=20971520,o.bits=1,0;for(y=1;y<w&&0===O[y];y++);for(k<y&&(k=y),b=z=1;b<=15;b++)if(z<<=1,(z-=O[b])<0)return -1;if(0<z&&(0===e||1!==w))return -1;for(B[1]=0,b=1;b<15;b++)B[b+1]=B[b]+O[b];for(v=0;v<n;v++)0!==t[r+v]&&(a[B[t[r+v]]++]=v);if(d=0===e?(A=R=a,19):1===e?(A=F,I-=257,R=N,T-=257,256):(A=U,R=P,-1),b=y,c=s,S=v=E=0,l=-1,f=(C=1<<(x=k))-1,1===e&&852<C||2===e&&592<C)return 1;for(;;){for(p=b-S,_=a[v]<d?(m=0,a[v]):a[v]>d?(m=R[T+a[v]],A[I+a[v]]):(m=96,0),h=1<<b-S,y=u=1<<x;i[c+(E>>S)+(u-=h)]=p<<24|m<<16|_|0,0!==u;);for(h=1<<b-1;E&h;)h>>=1;if(0!==h?(E&=h-1,E+=h):E=0,v++,0==--O[b]){if(b===w)break;b=t[r+a[v]];}if(k<b&&(E&f)!==l){for(0===S&&(S=k),c+=y,z=1<<(x=b-S);x+S<w&&!((z-=O[x+S])<=0);)x++,z<<=1;if(C+=1<<x,1===e&&852<C||2===e&&592<C)return 1;i[l=E&f]=k<<24|x<<16|c-s|0;}}return 0!==E&&(i[c+E]=b-S<<24|64<<16|0),o.bits=k,0};},{"../utils/common":41}],51:[function(e,t,r){t.exports={2:"need dictionary",1:"stream end",0:"","-1":"file error","-2":"stream error","-3":"data error","-4":"insufficient memory","-5":"buffer error","-6":"incompatible version"};},{}],52:[function(e,t,r){var i=e("../utils/common"),o=0,h=1;function n(e){for(var t=e.length;0<=--t;)e[t]=0;}var s=0,a=29,u=256,l=u+1+a,f=30,c=19,_=2*l+1,g=15,d=16,p=7,m=256,b=16,v=17,y=18,w=[0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0],k=[0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13],x=[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,3,7],S=[16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15],z=new Array(2*(l+2));n(z);var C=new Array(2*f);n(C);var E=new Array(512);n(E);var A=new Array(256);n(A);var I=new Array(a);n(I);var O,B,R,T=new Array(f);function D(e,t,r,n,i){this.static_tree=e,this.extra_bits=t,this.extra_base=r,this.elems=n,this.max_length=i,this.has_stree=e&&e.length;}function F(e,t){this.dyn_tree=e,this.max_code=0,this.stat_desc=t;}function N(e){return e<256?E[e]:E[256+(e>>>7)]}function U(e,t){e.pending_buf[e.pending++]=255&t,e.pending_buf[e.pending++]=t>>>8&255;}function P(e,t,r){e.bi_valid>d-r?(e.bi_buf|=t<<e.bi_valid&65535,U(e,e.bi_buf),e.bi_buf=t>>d-e.bi_valid,e.bi_valid+=r-d):(e.bi_buf|=t<<e.bi_valid&65535,e.bi_valid+=r);}function L(e,t,r){P(e,r[2*t],r[2*t+1]);}function j(e,t){for(var r=0;r|=1&e,e>>>=1,r<<=1,0<--t;);return r>>>1}function Z(e,t,r){var n,i,s=new Array(g+1),a=0;for(n=1;n<=g;n++)s[n]=a=a+r[n-1]<<1;for(i=0;i<=t;i++){var o=e[2*i+1];0!==o&&(e[2*i]=j(s[o]++,o));}}function W(e){var t;for(t=0;t<l;t++)e.dyn_ltree[2*t]=0;for(t=0;t<f;t++)e.dyn_dtree[2*t]=0;for(t=0;t<c;t++)e.bl_tree[2*t]=0;e.dyn_ltree[2*m]=1,e.opt_len=e.static_len=0,e.last_lit=e.matches=0;}function M(e){8<e.bi_valid?U(e,e.bi_buf):0<e.bi_valid&&(e.pending_buf[e.pending++]=e.bi_buf),e.bi_buf=0,e.bi_valid=0;}function H(e,t,r,n){var i=2*t,s=2*r;return e[i]<e[s]||e[i]===e[s]&&n[t]<=n[r]}function G(e,t,r){for(var n=e.heap[r],i=r<<1;i<=e.heap_len&&(i<e.heap_len&&H(t,e.heap[i+1],e.heap[i],e.depth)&&i++,!H(t,n,e.heap[i],e.depth));)e.heap[r]=e.heap[i],r=i,i<<=1;e.heap[r]=n;}function K(e,t,r){var n,i,s,a,o=0;if(0!==e.last_lit)for(;n=e.pending_buf[e.d_buf+2*o]<<8|e.pending_buf[e.d_buf+2*o+1],i=e.pending_buf[e.l_buf+o],o++,0===n?L(e,i,t):(L(e,(s=A[i])+u+1,t),0!==(a=w[s])&&P(e,i-=I[s],a),L(e,s=N(--n),r),0!==(a=k[s])&&P(e,n-=T[s],a)),o<e.last_lit;);L(e,m,t);}function Y(e,t){var r,n,i,s=t.dyn_tree,a=t.stat_desc.static_tree,o=t.stat_desc.has_stree,h=t.stat_desc.elems,u=-1;for(e.heap_len=0,e.heap_max=_,r=0;r<h;r++)0!==s[2*r]?(e.heap[++e.heap_len]=u=r,e.depth[r]=0):s[2*r+1]=0;for(;e.heap_len<2;)s[2*(i=e.heap[++e.heap_len]=u<2?++u:0)]=1,e.depth[i]=0,e.opt_len--,o&&(e.static_len-=a[2*i+1]);for(t.max_code=u,r=e.heap_len>>1;1<=r;r--)G(e,s,r);for(i=h;r=e.heap[1],e.heap[1]=e.heap[e.heap_len--],G(e,s,1),n=e.heap[1],e.heap[--e.heap_max]=r,e.heap[--e.heap_max]=n,s[2*i]=s[2*r]+s[2*n],e.depth[i]=(e.depth[r]>=e.depth[n]?e.depth[r]:e.depth[n])+1,s[2*r+1]=s[2*n+1]=i,e.heap[1]=i++,G(e,s,1),2<=e.heap_len;);e.heap[--e.heap_max]=e.heap[1],function(e,t){var r,n,i,s,a,o,h=t.dyn_tree,u=t.max_code,l=t.stat_desc.static_tree,f=t.stat_desc.has_stree,c=t.stat_desc.extra_bits,d=t.stat_desc.extra_base,p=t.stat_desc.max_length,m=0;for(s=0;s<=g;s++)e.bl_count[s]=0;for(h[2*e.heap[e.heap_max]+1]=0,r=e.heap_max+1;r<_;r++)p<(s=h[2*h[2*(n=e.heap[r])+1]+1]+1)&&(s=p,m++),h[2*n+1]=s,u<n||(e.bl_count[s]++,a=0,d<=n&&(a=c[n-d]),o=h[2*n],e.opt_len+=o*(s+a),f&&(e.static_len+=o*(l[2*n+1]+a)));if(0!==m){do{for(s=p-1;0===e.bl_count[s];)s--;e.bl_count[s]--,e.bl_count[s+1]+=2,e.bl_count[p]--,m-=2;}while(0<m);for(s=p;0!==s;s--)for(n=e.bl_count[s];0!==n;)u<(i=e.heap[--r])||(h[2*i+1]!==s&&(e.opt_len+=(s-h[2*i+1])*h[2*i],h[2*i+1]=s),n--);}}(e,t),Z(s,u,e.bl_count);}function X(e,t,r){var n,i,s=-1,a=t[1],o=0,h=7,u=4;for(0===a&&(h=138,u=3),t[2*(r+1)+1]=65535,n=0;n<=r;n++)i=a,a=t[2*(n+1)+1],++o<h&&i===a||(o<u?e.bl_tree[2*i]+=o:0!==i?(i!==s&&e.bl_tree[2*i]++,e.bl_tree[2*b]++):o<=10?e.bl_tree[2*v]++:e.bl_tree[2*y]++,s=i,u=(o=0)===a?(h=138,3):i===a?(h=6,3):(h=7,4));}function V(e,t,r){var n,i,s=-1,a=t[1],o=0,h=7,u=4;for(0===a&&(h=138,u=3),n=0;n<=r;n++)if(i=a,a=t[2*(n+1)+1],!(++o<h&&i===a)){if(o<u)for(;L(e,i,e.bl_tree),0!=--o;);else 0!==i?(i!==s&&(L(e,i,e.bl_tree),o--),L(e,b,e.bl_tree),P(e,o-3,2)):o<=10?(L(e,v,e.bl_tree),P(e,o-3,3)):(L(e,y,e.bl_tree),P(e,o-11,7));s=i,u=(o=0)===a?(h=138,3):i===a?(h=6,3):(h=7,4);}}n(T);var q=!1;function J(e,t,r,n){P(e,(s<<1)+(n?1:0),3),function(e,t,r,n){M(e),n&&(U(e,r),U(e,~r)),i.arraySet(e.pending_buf,e.window,t,r,e.pending),e.pending+=r;}(e,t,r,!0);}r._tr_init=function(e){q||(function(){var e,t,r,n,i,s=new Array(g+1);for(n=r=0;n<a-1;n++)for(I[n]=r,e=0;e<1<<w[n];e++)A[r++]=n;for(A[r-1]=n,n=i=0;n<16;n++)for(T[n]=i,e=0;e<1<<k[n];e++)E[i++]=n;for(i>>=7;n<f;n++)for(T[n]=i<<7,e=0;e<1<<k[n]-7;e++)E[256+i++]=n;for(t=0;t<=g;t++)s[t]=0;for(e=0;e<=143;)z[2*e+1]=8,e++,s[8]++;for(;e<=255;)z[2*e+1]=9,e++,s[9]++;for(;e<=279;)z[2*e+1]=7,e++,s[7]++;for(;e<=287;)z[2*e+1]=8,e++,s[8]++;for(Z(z,l+1,s),e=0;e<f;e++)C[2*e+1]=5,C[2*e]=j(e,5);O=new D(z,w,u+1,l,g),B=new D(C,k,0,f,g),R=new D(new Array(0),x,0,c,p);}(),q=!0),e.l_desc=new F(e.dyn_ltree,O),e.d_desc=new F(e.dyn_dtree,B),e.bl_desc=new F(e.bl_tree,R),e.bi_buf=0,e.bi_valid=0,W(e);},r._tr_stored_block=J,r._tr_flush_block=function(e,t,r,n){var i,s,a=0;0<e.level?(2===e.strm.data_type&&(e.strm.data_type=function(e){var t,r=4093624447;for(t=0;t<=31;t++,r>>>=1)if(1&r&&0!==e.dyn_ltree[2*t])return o;if(0!==e.dyn_ltree[18]||0!==e.dyn_ltree[20]||0!==e.dyn_ltree[26])return h;for(t=32;t<u;t++)if(0!==e.dyn_ltree[2*t])return h;return o}(e)),Y(e,e.l_desc),Y(e,e.d_desc),a=function(e){var t;for(X(e,e.dyn_ltree,e.l_desc.max_code),X(e,e.dyn_dtree,e.d_desc.max_code),Y(e,e.bl_desc),t=c-1;3<=t&&0===e.bl_tree[2*S[t]+1];t--);return e.opt_len+=3*(t+1)+5+5+4,t}(e),i=e.opt_len+3+7>>>3,(s=e.static_len+3+7>>>3)<=i&&(i=s)):i=s=r+5,r+4<=i&&-1!==t?J(e,t,r,n):4===e.strategy||s===i?(P(e,2+(n?1:0),3),K(e,z,C)):(P(e,4+(n?1:0),3),function(e,t,r,n){var i;for(P(e,t-257,5),P(e,r-1,5),P(e,n-4,4),i=0;i<n;i++)P(e,e.bl_tree[2*S[i]+1],3);V(e,e.dyn_ltree,t-1),V(e,e.dyn_dtree,r-1);}(e,e.l_desc.max_code+1,e.d_desc.max_code+1,a+1),K(e,e.dyn_ltree,e.dyn_dtree)),W(e),n&&M(e);},r._tr_tally=function(e,t,r){return e.pending_buf[e.d_buf+2*e.last_lit]=t>>>8&255,e.pending_buf[e.d_buf+2*e.last_lit+1]=255&t,e.pending_buf[e.l_buf+e.last_lit]=255&r,e.last_lit++,0===t?e.dyn_ltree[2*r]++:(e.matches++,t--,e.dyn_ltree[2*(A[r]+u+1)]++,e.dyn_dtree[2*N(t)]++),e.last_lit===e.lit_bufsize-1},r._tr_align=function(e){P(e,2,3),L(e,m,z),function(e){16===e.bi_valid?(U(e,e.bi_buf),e.bi_buf=0,e.bi_valid=0):8<=e.bi_valid&&(e.pending_buf[e.pending++]=255&e.bi_buf,e.bi_buf>>=8,e.bi_valid-=8);}(e);};},{"../utils/common":41}],53:[function(e,t,r){t.exports=function(){this.input=null,this.next_in=0,this.avail_in=0,this.total_in=0,this.output=null,this.next_out=0,this.avail_out=0,this.total_out=0,this.msg="",this.state=null,this.data_type=2,this.adler=0;};},{}],54:[function(e,t,r){(function(e){!function(r,n){if(!r.setImmediate){var i,s,t,a,o=1,h={},u=!1,l=r.document,e=Object.getPrototypeOf&&Object.getPrototypeOf(r);e=e&&e.setTimeout?e:r,i="[object process]"==={}.toString.call(r.process)?function(e){process.nextTick(function(){c(e);});}:function(){if(r.postMessage&&!r.importScripts){var e=!0,t=r.onmessage;return r.onmessage=function(){e=!1;},r.postMessage("","*"),r.onmessage=t,e}}()?(a="setImmediate$"+Math.random()+"$",r.addEventListener?r.addEventListener("message",d,!1):r.attachEvent("onmessage",d),function(e){r.postMessage(a+e,"*");}):r.MessageChannel?((t=new MessageChannel).port1.onmessage=function(e){c(e.data);},function(e){t.port2.postMessage(e);}):l&&"onreadystatechange"in l.createElement("script")?(s=l.documentElement,function(e){var t=l.createElement("script");t.onreadystatechange=function(){c(e),t.onreadystatechange=null,s.removeChild(t),t=null;},s.appendChild(t);}):function(e){setTimeout(c,0,e);},e.setImmediate=function(e){"function"!=typeof e&&(e=new Function(""+e));for(var t=new Array(arguments.length-1),r=0;r<t.length;r++)t[r]=arguments[r+1];var n={callback:e,args:t};return h[o]=n,i(o),o++},e.clearImmediate=f;}function f(e){delete h[e];}function c(e){if(u)setTimeout(c,0,e);else {var t=h[e];if(t){u=!0;try{!function(e){var t=e.callback,r=e.args;switch(r.length){case 0:t();break;case 1:t(r[0]);break;case 2:t(r[0],r[1]);break;case 3:t(r[0],r[1],r[2]);break;default:t.apply(n,r);}}(t);}finally{f(e),u=!1;}}}}function d(e){e.source===r&&"string"==typeof e.data&&0===e.data.indexOf(a)&&c(+e.data.slice(a.length));}}("undefined"==typeof self?void 0===e?this:e:self);}).call(this,"undefined"!=typeof commonjsGlobal?commonjsGlobal:"undefined"!=typeof self?self:"undefined"!=typeof window?window:{});},{}]},{},[10])(10)});
	}(jszip_min));

	var JSZip = jszip_min.exports;

	/**
	 * @singleton
	 * @description bus
	 * @example
	 * 		busEvent.on(name, handler(data))
	 * 		busEvent.fire(name, data)
	 */


	const busEvent = new (class {
		#handlers = {};

		on(name, handler) {
			if (!this.#handlers[name]) {
				this.#handlers[name] = new Pool();
			}
			this.#handlers[name].push(handler);
		}

		fire(name, data) {
			if (this.#handlers[name]) {
				this.#handlers[name].run(data);
			}
		}
	})();

	const rules$d = [{"selector":"x-tpl_createproject ","rule":"display: block;padding: 20px;"},{"selector":"x-tpl_createproject table ","rule":"border-collapse: collapse;"},{"selector":"x-tpl_createproject table tr td ","rule":"padding: 0;"},{"selector":"x-tpl_createproject table tr td:nth-child(1) ","rule":"width: 100px;"},{"selector":"x-tpl_createproject table tr td:nth-child(2) ","rule":"font-size: 0;"},{"selector":"x-tpl_createproject table tr td:nth-child(2) > * ","rule":"width: 200px;margin: 5px 0;"},{"selector":"x-tpl_createproject .control ","rule":"float: right;"},{"selector":"x-tpl_createproject .control button ","rule":"margin: 20px 0 0 10px;"}];
				let cssStyle$d;
				const css$d = {
					install:() => {
						cssStyle$d = document.createElement("style");
						document.head.appendChild(cssStyle$d);
						const cssStyleSheet = cssStyle$d.sheet;
						rules$d.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/modal/project/createProject/createProject.css]:', rules);
					},
					remove:() => {
						if (cssStyle$d) {document.head.removeChild(cssStyle$d);}
					}
				};

	const rules$c = [{"selector":"x-dropdown ","rule":"display: inline-block;position: relative;margin: 0;padding: 0;font-size: 0;"},{"selector":"x-dropdown[disabled='disabled'] ","rule":"opacity: 0.5;"},{"selector":"x-dropdown div[name='selectedName'] ","rule":"background: var(--input-bg-color);font-size: var(--input-font-size);color: var(--input-text-color);border: var(--input-border);border-radius: var(--element-border-radius);padding: 4px 22px 4px 8px;position: relative;box-sizing: border-box;height: 24px;"},{"selector":"x-dropdown div[name='selectedName']::after ","rule":"position: absolute;right: 3px;"},{"selector":"x-dropdown div[name='selectedName'].expanded::after ","rule":"display: inline-block;content: '↥';"},{"selector":"x-dropdown div[name='selectedName']:not(.expanded)::after ","rule":"display: inline-block;content: '↧';"},{"selector":"x-dropdown div[name='listContainer'] ","rule":"border: var(--input-border);border-radius: var(--input-border-radius);background: var(--input-bg-color);color: var(--element-text-color);overflow: hidden;position: absolute;margin-top: 1px;left: 0;width: 100%;box-sizing: border-box;z-index: 10000;"},{"selector":"x-dropdown div[name='list'] ","rule":"overflow-y: auto;overflow-x: hidden;max-height: 100%;display: block;"},{"selector":"x-dropdown div[name='listContainer']:not(.expanded) ","rule":"display: none;"},{"selector":"x-dropdown div[name='listContainer'].expanded ","rule":"display: block;"},{"selector":"x-dropdown item ","rule":"display: block;padding: 2px 4px;font-size: 12px;cursor: default;"},{"selector":"x-dropdown item:hover ","rule":"background: var(--element-selected-bg-color);"},{"selector":"x-dropdown splitter ","rule":"display: block;height: 1px;width: 100%;background: var(--element-border-color);"}];
				let cssStyle$c;
				const css$c = {
					install:() => {
						cssStyle$c = document.createElement("style");
						document.head.appendChild(cssStyle$c);
						const cssStyleSheet = cssStyle$c.sheet;
						rules$c.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/ui/dropdown/dropdown.css]:', rules);
					},
					remove:() => {
						if (cssStyle$c) {document.head.removeChild(cssStyle$c);}
					}
				};

	let Tpl_dropdown = class extends RP {
						constructor(model, logic) {
							const tree = {"vDom":{"tree":[{"type":"tag","tagName":"div","attrs":{"name":{"value":"selectedName","type":"string"},"onclick":{"type":"event","fn":"self.stateChange();"}},"childNodes":[{"type":"splitNode"},{"type":"textNode","value":"","placeNum":13,"valueInRender":null,"valueOutRender":"m.selectedName","modelDepends":[{"refName":"m","modelPath":"selectedName","canSync":true}]},{"type":"splitNode"}]},{"type":"tag","tagName":"div","attrs":{"name":{"value":"listContainer","type":"string"}},"childNodes":[{"type":"tag","tagName":"div","attrs":{"name":{"value":"list","type":"string"}},"childNodes":[]}]}]}};
							super(tree, model, logic);
						}
					};
					customElements.define('x-tpl_dropdown', Tpl_dropdown);

	css$c.install();

	/**
	 * @example	usage:
	 * 		1)	<x-dropdown value:="m.value" items:="m.items"></x-dropdown>
	 * 		2)
	 * 			<x-dropdown value:="m.value">
	 * 				<item value='1'>Item1</item>
	 * 				<item value='2'>Item2</item>
	 * 			</x-dropdown>
	 */

	class Dropdown extends HTMLElement {
		model;
		#isDisabled = false;
		#isExpanded = false;
		#items;					//[{title: string, value: any}]
		#indexedItems;			//{value: {title, value}}}
		#$wrapper;
		#$listContainer;
		#$list;
		#$selectedName;

		constructor(model) {
			super();
			this.model = model;
			//console.log('[dd] model:', model);
			this.#$wrapper = new Tpl_dropdown(model, this);

			this.#$listContainer = this.#$wrapper.querySelector('div[name="listContainer"]');
			this.#$list = this.#$listContainer.querySelector('div[name="list"]');

			this.#$selectedName = this.#$wrapper.querySelector('div[name="selectedName"]');

			this.height = this.getAttribute('height');
			this.#$list.style.height = this.height + 'px';

			this.model.addEventListener('change', 'value', cfg => {
				this.#setValue(cfg.newValue);
			});

			document.addEventListener('mousedown', (e) => {
				if (!isChildOf(e.target, this)) {
					this.#close();
				}
			});
		}


		connectedCallback() {
			if (this.model.data['items']) {
				this.#items = this.model.data['items'];
			} else if (this.childNodes.length) {
				this.#items = Array.from(this.querySelectorAll('item')).map($item => {
					let title = $item.innerText;
					let value = $item.getAttribute('value');
					return {title: title, value: value};
				});
				childNodesRemove(this);
			}
			this.appendChild(this.#$wrapper);

			if (this.#items) {
				this.init(this.#items);
			}
		}

		disconnectedCallback() {
			//TODO: remove mousedownEvent
		}

		/**
		 * @param items		// [{title: string, value: any}]	||	['title1', 'title2', ...]
		 */
		init(items) {
			if (typeof items[0] === 'string') {								//Если передан массив строк, то преобразуем его к формату [{title, value}]
				items = items.map((value, num) => {
					return {title: value, value: num};
				});
			}
			//console.log('[DD] init data:', data);

			this.#indexedItems = {};
			items.forEach(item => {
				this.#indexedItems[item.value] = item;
			});

			/*
			let title;
			if (this.#selectedValue) {
				let value = this.#indexedItems[this.#selectedValue];
				if (value) {
					title = value.title;
				}
			}
			if (title === undefined) {								//Если выбранного значения нет, либо его удалили
				if (this.#items && this.#items[0]) {				//Если вообще есть значения - берем первое
					this.#selectedValue = this.#items[0].value;
					title = this.#items[0].title;
				} else {											//Иначе сбрасываем выбранное
					this.#selectedValue = undefined;
					title = '';
				}
			}
			*/
			this.#render();

			this.#setValue(this.model.data['value']);		//render selected first item
		}

		/*
		//TODO get from model attributes
		get disabled() {
			return this.#isDisabled;
		}

		set disabled(value) {
			if (value && !this.#isDisabled) {
				this.setAttribute('disabled', 'disabled');
			} else if (!value && this.#isDisabled) {
				this.removeAttribute('disabled');
			}
			this.#isDisabled = value;
		}*/


		/**
		 * @description Open/close
		 * @param state
		 */
		stateChange(state) {
			if (this.#isDisabled) {
				return;
			}
			if (state === undefined) {
				this.#isExpanded = !this.#isExpanded;
			} else {
				this.#isExpanded = state;
			}

			let viewport = this.getBoundingClientRect();
			let height = this.#$selectedName.offsetHeight;
			if ((viewport.y + height / 2) > document.body.clientHeight / 2) {	//suggest находится в нижней части экрана - раскрываем его вверх
				this.#$listContainer.style.top = 'unset';
				this.#$listContainer.style.bottom = (height + 1) + 'px';
			} else {														//suggest в верхней части экрана
				this.#$listContainer.style.top = (height + 1) + 'px';
				this.#$listContainer.style.bottom = 'unset';
			}

			this.#$listContainer.className = this.#isExpanded ? 'expanded' : '';
			this.#$selectedName.className = this.#isExpanded ? 'expanded' : '';
		}


		#render() {
			childNodesRemove(this.#$list);
			this.#items.forEach((item) => {
				let $item;
				if (item['splitter']) {
					$item = document.createElement('splitter');
				} else {
					$item = document.createElement('item');
					$item.innerText = item.title;
					$item.addEventListener('click', () => {
						this.stateChange(false);
						this.#setValue(item.value);
					});
				}
				this.#$list.appendChild($item);
			});
		}


		/**
		 * @param value
		 */
		#setValue(value) {
			if (typeof value === 'number' || typeof value === 'string') {
				let item = this.#indexedItems[value];
				if (item) {
					this.model.data['selectedName'] = item.title;
				} else {
					//console.warn("[DD] Can't set not existed value:', value, this.#indexedItems, 'Set first value");
					value = this.#items[0].value;
					this.model.data['selectedName'] = this.#items[0].title;
				}
				//console.log('[setValue]', value, this.model.data['value']);
				if (this.model.data['value'] !== value) {
					this.model.data['value'] = value;
				}
			}
		}


		#close() {
			this.stateChange(false);
		}
	}

	customElements.define('x-dropdown', Dropdown);

	let Tpl_createProject = class extends RP {
						constructor(model, logic) {
							const tree = {"vDom":{"tree":[{"type":"tag","tagName":"table","attrs":{},"childNodes":[{"type":"tag","tagName":"tr","attrs":{},"childNodes":[{"type":"tag","tagName":"td","attrs":{},"childNodes":[{"type":"textNode","value":"Project name"}]},{"type":"tag","tagName":"td","attrs":{},"childNodes":[{"type":"tag","tagName":"input","attrs":{"value":{"type":"string","valueInRender":null,"valueOutRender":"(m.name)","modelOut":[{"refName":"m","modelPath":"name"}],"modelDepends":[{"refName":"m","modelPath":"name","canSync":false}]},"name":{"value":"name","type":"string"},"onkeydown":{"type":"event","fn":"self.onKeyDown(e);"}},"childNodes":[]}]}]},{"type":"tag","tagName":"tr","attrs":{},"childNodes":[{"type":"tag","tagName":"td","attrs":{},"childNodes":[{"type":"textNode","value":"Language"}]},{"type":"tag","tagName":"td","attrs":{},"childNodes":[{"type":"component","tagName":"x-dropdown","attrs":{"value":{"valueOutRender":"m.language","modelDepends":[{"refName":"m","modelPath":"language","valueOutRender":"m.language","jsonInnerPath":""}],"modelOut":[{"refName":"m","modelPath":"language"}],"type":"json"}},"childNodes":[{"type":"tag","tagName":"item","attrs":{"value":{"value":"js","type":"string"}},"childNodes":[{"type":"textNode","value":"Javascript(console)"}]},{"type":"tag","tagName":"item","attrs":{"value":{"value":"ink","type":"string"}},"childNodes":[{"type":"textNode","value":"Ink!"}]},{"type":"tag","tagName":"item","attrs":{"value":{"value":"sol","type":"string"}},"childNodes":[{"type":"textNode","value":"Solidity"}]}]}]}]}]},{"type":"tag","tagName":"div","attrs":{"class":{"value":"control","type":"string"}},"childNodes":[{"type":"tag","tagName":"button","attrs":{"class":{"value":"big main","type":"string"},"onclick":{"type":"event","fn":"self.create();"}},"childNodes":[{"type":"textNode","value":"Create project"}]},{"type":"tag","tagName":"button","attrs":{"class":{"value":"big","type":"string"},"onclick":{"type":"event","fn":"self.cancel();"}},"childNodes":[{"type":"textNode","value":"Cancel"}]}]}]}};
							super(tree, model, logic);
						}
					};
					customElements.define('x-tpl_createproject', Tpl_createProject);

	css$d.install();

	/**
	 * @param cfg			{Object}
	 * @param cfg.onCreate	{Object}
	 */
	const createProject = cfg => new (class {
		#$window;
		#$createProject;
		#onCreate;

		constructor() {
			this.#onCreate = cfg.onCreate;
			this.#$createProject = new Tpl_createProject({name: '', language: 'js'}, this);
			this.#$window = new Window({
				title: 'New project',
				width: 340,
				height: 160,
				uiLock: true,
				$content: this.#$createProject
			});
			this.#$window.querySelector('input[name=name]').focus();
		};

		onKeyDown(e) {
			if (e.code === "Enter") {
				this.create();
			}
		}

		create() {
			this.#$window.close();
			this.#onCreate({
				name: this.#$createProject.model.data.name,
				language: this.#$createProject.model.data.language
			});
		}

		cancel() {
			this.#$window.close();
		}
	})();

	const rules$b = [{"selector":"x-tpl_createfile ","rule":"display: block;padding: 20px;"},{"selector":"x-tpl_createfile table ","rule":"border-collapse: collapse;"},{"selector":"x-tpl_createfile table tr td ","rule":"padding: 0;"},{"selector":"x-tpl_createfile table tr td:nth-child(1) ","rule":"width: 100px;"},{"selector":"x-tpl_createfile table tr td:nth-child(2) ","rule":"font-size: 0;"},{"selector":"x-tpl_createfile table tr td:nth-child(2) > * ","rule":"width: 200px;margin: 5px 0;"},{"selector":"x-tpl_createfile .control ","rule":"float: right;"},{"selector":"x-tpl_createfile .control button ","rule":"margin: 20px 0 0 10px;"}];
				let cssStyle$b;
				const css$b = {
					install:() => {
						cssStyle$b = document.createElement("style");
						document.head.appendChild(cssStyle$b);
						const cssStyleSheet = cssStyle$b.sheet;
						rules$b.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/modal/project/createFile/createFile.css]:', rules);
					},
					remove:() => {
						if (cssStyle$b) {document.head.removeChild(cssStyle$b);}
					}
				};

	let Tpl_createFile = class extends RP {
						constructor(model, logic) {
							const tree = {"vDom":{"tree":[{"type":"tag","tagName":"table","attrs":{},"childNodes":[{"type":"tag","tagName":"tr","attrs":{},"childNodes":[{"type":"tag","tagName":"td","attrs":{},"childNodes":[{"type":"textNode","value":"File name"}]},{"type":"tag","tagName":"td","attrs":{},"childNodes":[{"type":"tag","tagName":"input","attrs":{"value":{"type":"string","valueInRender":null,"valueOutRender":"(m.name)","modelOut":[{"refName":"m","modelPath":"name"}],"modelDepends":[{"refName":"m","modelPath":"name","canSync":false}]},"name":{"value":"name","type":"string"},"onkeydown":{"type":"event","fn":"self.onKeyDown(e);"}},"childNodes":[]}]}]}]},{"type":"tag","tagName":"div","attrs":{"class":{"value":"control","type":"string"}},"childNodes":[{"type":"tag","tagName":"button","attrs":{"class":{"value":"big main","type":"string"},"onclick":{"type":"event","fn":"self.create();"}},"childNodes":[{"type":"textNode","value":"Create file"}]},{"type":"tag","tagName":"button","attrs":{"class":{"value":"big","type":"string"},"onclick":{"type":"event","fn":"self.cancel();"}},"childNodes":[{"type":"textNode","value":"Cancel"}]}]}]}};
							super(tree, model, logic);
						}
					};
					customElements.define('x-tpl_createfile', Tpl_createFile);

	css$b.install();

	/**
	 * @param cfg				{Object}
	 * @param cfg.onCreate		{Function}
	 * @param cfg.parentNode	{Object}
	 */
	const createFile = cfg => new (class {
		#$window;
		#$createFile;
		#cfg;

		constructor() {
			this.#cfg = cfg;
			this.#$createFile = new Tpl_createFile({name: ''}, this);
			this.#$window = new Window({
				title: 'New file',
				width: 340,
				height: 145,
				uiLock: true,
				$content: this.#$createFile
			});
			this.#$window.querySelector('input[name=name]').focus();
		};

		onKeyDown(e) {
			if (e.code === "Enter") {
				this.create();
			}
		}

		create() {
			if (this.#cfg.node.childNodes.find(item => item.title === this.#$createFile.model.data.name)) {
				alert('already exist');
				return;
			}
			this.#$window.close();
			this.#cfg.onCreate({
				name: this.#$createFile.model.data.name
			});
		}

		cancel() {
			this.#$window.close();
		}
	})();

	const rules$a = [{"selector":"x-tpl_createdirectory ","rule":"display: block;padding: 20px;"},{"selector":"x-tpl_createdirectory table ","rule":"border-collapse: collapse;"},{"selector":"x-tpl_createdirectory table tr td ","rule":"padding: 0;"},{"selector":"x-tpl_createdirectory table tr td:nth-child(1) ","rule":"width: 100px;"},{"selector":"x-tpl_createdirectory table tr td:nth-child(2) ","rule":"font-size: 0;"},{"selector":"x-tpl_createdirectory table tr td:nth-child(2) > * ","rule":"width: 200px;margin: 5px 0;"},{"selector":"x-tpl_createdirectory .control ","rule":"float: right;"},{"selector":"x-tpl_createdirectory .control button ","rule":"margin: 20px 0 0 10px;"}];
				let cssStyle$a;
				const css$a = {
					install:() => {
						cssStyle$a = document.createElement("style");
						document.head.appendChild(cssStyle$a);
						const cssStyleSheet = cssStyle$a.sheet;
						rules$a.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/modal/project/createDirectory/createDirectory.css]:', rules);
					},
					remove:() => {
						if (cssStyle$a) {document.head.removeChild(cssStyle$a);}
					}
				};

	let Tpl_createDirectory = class extends RP {
						constructor(model, logic) {
							const tree = {"vDom":{"tree":[{"type":"tag","tagName":"table","attrs":{},"childNodes":[{"type":"tag","tagName":"tr","attrs":{},"childNodes":[{"type":"tag","tagName":"td","attrs":{},"childNodes":[{"type":"textNode","value":"Directory name"}]},{"type":"tag","tagName":"td","attrs":{},"childNodes":[{"type":"tag","tagName":"input","attrs":{"value":{"type":"string","valueInRender":null,"valueOutRender":"(m.name)","modelOut":[{"refName":"m","modelPath":"name"}],"modelDepends":[{"refName":"m","modelPath":"name","canSync":false}]},"name":{"value":"name","type":"string"},"onkeydown":{"type":"event","fn":"self.onKeyDown(e);"}},"childNodes":[]}]}]}]},{"type":"tag","tagName":"div","attrs":{"class":{"value":"control","type":"string"}},"childNodes":[{"type":"tag","tagName":"button","attrs":{"class":{"value":"big main","type":"string"},"onclick":{"type":"event","fn":"self.create();"}},"childNodes":[{"type":"textNode","value":"Create directory"}]},{"type":"tag","tagName":"button","attrs":{"class":{"value":"big","type":"string"},"onclick":{"type":"event","fn":"self.cancel();"}},"childNodes":[{"type":"textNode","value":"Cancel"}]}]}]}};
							super(tree, model, logic);
						}
					};
					customElements.define('x-tpl_createdirectory', Tpl_createDirectory);

	css$a.install();

	/**
	 * @param cfg				{Object}
	 * @param cfg.onCreate		{Function}
	 * @param cfg.parentNode	{Object}
	 */
	const createDirectory = cfg => new (class {
		#$window;
		#$createDirectory;
		#cfg;

		constructor() {
			this.#cfg = cfg;
			this.#$createDirectory = new Tpl_createDirectory({name: ''}, this);
			this.#$window = new Window({
				title: 'New directory',
				width: 340,
				height: 145,
				uiLock: true,
				$content: this.#$createDirectory
			});
			this.#$window.querySelector('input[name=name]').focus();
		};

		onKeyDown(e) {
			if (e.code === "Enter") {
				this.create();
			}
		}

		create() {
			if (this.#cfg.node.childNodes.find(item => item.title === this.#$createDirectory.model.data.name)) {
				alert('already exist');
				return;
			}
			this.#$window.close();
			this.#cfg.onCreate({
				name: this.#$createDirectory.model.data.name
			});
		}

		cancel() {
			this.#$window.close();
		}
	})();

	const rules$9 = [{"selector":"x-tpl_prompt ","rule":"display: block;padding: 20px;"},{"selector":"x-tpl_prompt > div ","rule":"height: 60px;"},{"selector":"x-tpl_prompt .control ","rule":"float: right;"},{"selector":"x-tpl_prompt .control button ","rule":"margin: 20px 0 0 10px;"}];
				let cssStyle$9;
				const css$9 = {
					install:() => {
						cssStyle$9 = document.createElement("style");
						document.head.appendChild(cssStyle$9);
						const cssStyleSheet = cssStyle$9.sheet;
						rules$9.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/ui/prompt/prompt.css]:', rules);
					},
					remove:() => {
						if (cssStyle$9) {document.head.removeChild(cssStyle$9);}
					}
				};

	let Tpl_Prompt = class extends RP {
						constructor(model, logic) {
							const tree = {"vDom":{"tree":[{"type":"tag","tagName":"div","attrs":{},"childNodes":[{"type":"splitNode"},{"type":"textNode","value":"","placeNum":8,"valueInRender":null,"valueOutRender":"m.prompt","modelDepends":[{"refName":"m","modelPath":"prompt","canSync":true}]},{"type":"splitNode"}]},{"type":"tag","tagName":"div","attrs":{"class":{"value":"control","type":"string"}},"childNodes":[{"type":"tag","tagName":"button","attrs":{"class":{"value":"big main","type":"string"},"onclick":{"type":"event","fn":"self.yes();"}},"childNodes":[{"type":"textNode","value":"Yes"}]},{"type":"tag","tagName":"button","attrs":{"class":{"value":"big","type":"string"},"onclick":{"type":"event","fn":"self.no();"}},"childNodes":[{"type":"textNode","value":"No"}]}]}]}};
							super(tree, model, logic);
						}
					};
					customElements.define('x-tpl_prompt', Tpl_Prompt);

	css$9.install();

	/**
	 * @param cfg			{Object}
	 * @param cfg.title		{String}
	 * @param cfg.prompt	{String}
	 * @param cfg.yes		{Function}
	 * @param cfg.no		{Function}
	 */
	const Prompt = class {
		#$window;
		#$content;
		#cfg;

		constructor(cfg) {
			this.#cfg = cfg;
			this.#$content = new Tpl_Prompt({prompt: cfg.prompt}, this);
			this.#$window = new Window({
				title: cfg.title,
				width: 340,
				height: 145,
				uiLock: true,
				$content: this.#$content
			});
			//this.#$window.querySelector('input[name=name]').focus();
		};

		yes() {
			this.#$window.close();
			this.#cfg.yes();
		}

		no() {
			this.#$window.close();
			if (this.#cfg.no) {
				this.#cfg.no();
			}
		}

		cancel() {
			this.#$window.close();
		}
	};

	const PathNavigator = class {
		#rootPath;
		constructor(rootPath) {
			this.#rootPath = rootPath;
		}

		navigate(relativePath) {
			return (new URL(relativePath, "http://x/" + this.#rootPath).href).replace(/^http:\/\/x\//, '');
		}
	};

	/**
	 * @description downloadFile
	 * @returns {(function(*, *): void)|*}
	 */

	const a = document.createElement("a");
	document.body.appendChild(a);
	a.style.display = "none";

	const file = {
		download: (data, fileName) => {
			if (!(data instanceof Blob)) {
				data = new Blob([data], {type: "octet/stream"});
			}
			const url = window.URL.createObjectURL(data);
			a.href = url;
			a.download = fileName;
			a.click();
			window.URL.revokeObjectURL(url);
		}
	};

	window.ideLog = (type, text) => {
		busEvent.fire('actions.log.add', {text: text, type: type, date: new Date()});
	};

	class Project {
		#buildFrame;

		constructor(projData) {
			this.model = new ObjectLive({
				isChanged: false,
				struct: projData					// {tree: [], settings: {}}
			});

			//this.libRefresh('@polkadot/api', 'polkadot_api.js').then(()=>{});
			//this.libRefresh('@polkadot/util-crypto', 'polkadot_util-crypto.js').then(()=>{});

			this.model.addEventListener('change', /^struct.*/, (cfg) => {
				//console.log('struct changed:', cfg);
				this.localSave();
			});
		}

		localSave() {
			localStorage.setItem('currentProject', JSON.stringify(this.model.data.struct));
		}

		#fileContentGet(filePath) {
			return filePath.split('/').reduce((node, childName) => {
				return node.childNodes.find(item => item.title === childName);
			}, projectManager.project.model.data.struct.tree[0]).data;
		}

		#libContentGet(libName) {
			return this.model.data.struct.tree[1].childNodes.find(lib => lib.title === libName).data;
		}

		build() {
			//open console
			busEvent.fire("actions.panel.open", "console");

			const indexFile = this.model.data.struct.tree[0].childNodes.find(fileNode => fileNode.title === 'app.js');
			//console.log('indexFile:', indexFile);
			if (indexFile) {
				const moduleFileByUrl = {};	// {url: filePath, "blob:http://gitmodules.local/a89230eb-1d98-4dff-8128-25ef15b7228d": "test.js"}
				const moduleUrlByFile = {};	// {filePath: url, "test.js": "blob:http://gitmodules.local/a89230eb-1d98-4dff-8128-25ef15b7228d"}

				if (this.#buildFrame) {
					document.body.removeChild(this.#buildFrame);
				}
				this.#buildFrame = document.createElement("IFRAME");
				this.#buildFrame.src = "about:blank";
				this.#buildFrame.style.visibility = "hidden";
				document.body.appendChild(this.#buildFrame);

				const scriptAdd = (scp, moduleUrl) => {
					let mod = document.createElement('script');
					if (moduleUrl) {
						mod.type = "module";
						mod.src = moduleUrl;
					} else {
						mod.textContent = scp;
					}
					this.#buildFrame.contentWindow.document.body.appendChild(mod);
				};

				const dependencies = [];

				const moduleInit = (srcFilePath) => {
					dependencies.push(srcFilePath);

					let srcPathAddr = new PathNavigator(srcFilePath);
					let srcContent;
					if (this.model.data.struct.tree[1].childNodes.find(lib => lib.title === srcFilePath)) {
						srcContent = this.#libContentGet(srcFilePath);
					} else {
						try {
							srcContent = this.#fileContentGet(srcFilePath);
						} catch (e) {}
					}
					if (!srcContent) {
						return null;
					}

					/*
						TODO: ignore imports in single comments '//',	reg = /(?<!^[\p{Zs}\t]*\/\/.*)/g
					*/
					srcContent = srcContent.replace(/(?<!\/\*(?:(?!\*\/)[\s\S\r])*?)(import.*? from[\s\t+])(['"])(.*?)\2;/igm, (_, what, quote, relativeModulePath) => {
						if (this.model.data.struct.tree[1].childNodes.find(lib => lib.title === relativeModulePath)) {		// if lib exist
							//console.log('%cfind import:', 'background:green;', relativeModulePath, moduleUrlByFile);
							if (moduleUrlByFile[relativeModulePath]) {						//if already imported early
								return `${what} "${moduleUrlByFile[relativeModulePath]}";`;
							} else {
								const replacedUrl = moduleInit(relativeModulePath);
								return replacedUrl!==null ? `${what} "${replacedUrl}";` : `${what} "${relativeModulePath}";`;		// code of imports
							}
						} else {
							const moduleFilePath = srcPathAddr.navigate(relativeModulePath);
							const replacedUrl = moduleInit(moduleFilePath);
							//console.log('%c moduleFilePath:', 'background:magenta; color:white;', moduleFilePath);
							return replacedUrl !==null ? `${what} "${replacedUrl}";` : `${what} "${relativeModulePath}";`;
						}
					});
					return depAdd(srcFilePath, srcContent);						// module blob url
				};

				const depAdd = (moduleFilePath, srcContent) => {
					const blob = new Blob([srcContent], {type: 'application/javascript'});
					const moduleUrl = URL.createObjectURL(blob);
					moduleFileByUrl[moduleUrl] = moduleFilePath;
					moduleUrlByFile[moduleFilePath] = moduleUrl;
					return moduleUrl;
				};

				scriptAdd(`top.ideLog('action', 'Launched "app.js"');`);
				moduleInit('app.js');
				scriptAdd(`
				let moduleFileByUrl = ${JSON.stringify(moduleFileByUrl)};
				const errs = {};
				const pathsFix = (text) => {
					return text.replace(/(blob:https?:\\/\\/[^/]+\\/[a-z0-9\\-]{36})/gm, (_, url) => {
						return moduleFileByUrl[url];
					});
				};

				window.addEventListener("error", (e) => {
					const text = pathsFix(e.message + '\\nat ' + e.filename + ':' + e.lineno + ':' + e.colno);
					if (!errs[text]) {
						errs[text] = 1;
						top.ideLog('error', text);
					}
					e.preventDefault();
				});
				window.addEventListener("unhandledrejection", function (e) {
					const text = e.reason.fileName ? ('ReferenceError: ' + e.reason.message + '\\nat ' + e.reason.fileName + ':' + e.reason.lineNumber + ':' + e.reason.columnNumber) : e.reason.stack;
					top.ideLog('error', pathsFix(text));
					e.preventDefault();
				});

				console.log = function() {
					top.ideLog('text', Array.from(arguments).join(' '));
				};
				console.warn = function() {
					top.ideLog('warn', Array.from(arguments).join(' '));
				};
			`);

				setTimeout(() => {
					dependencies.reverse().forEach(moduleFilePath => {
						scriptAdd(null, moduleUrlByFile[moduleFilePath]);
					});
				}, 0);
			} else {
				busEvent.fire('actions.log.add', {text: 'Index file "app.js" is missing', type: 'error', date: new Date()});
			}
		}


		libAdd(title, name) {
			if (!this.model.data.struct.tree[1].childNodes.find(lib => lib.title === title)) {
				return new Promise(resolve => {
					this.libLoad(name).then(content => {
						this.model.data.struct.tree[1].childNodes.push({
							ico: 'file_js',
							title: title,
							data: content,
							color: '#fff',
							isDirectory: false,
							isVisible: true,
							readonly: true
						});
						resolve();
					});
				});
			} else {
				return new Promise(resolve => {				//return "dummy promise" if lib already loading
					resolve();
				})
			}
		}

		libRefresh(title, name) {
			let libObj = this.model.data.struct.tree[1].childNodes.find(lib => lib.title === title);
			if (!libObj) {
				return this.libAdd(title,name);
			} else {
				return new Promise(resolve => {
					this.libLoad(name).then(content => {
						libObj.data = content;
						resolve();
					});
				});
			}
		}

		libLoad(name) {
			return new Promise(resolve => {
				const req = new XMLHttpRequest();
				req.onload = e => {
					resolve(e.target.response);
				};
				req.open("GET", "./libs/" + name);
				req.send();
			});
		}

		export() {
			console.log('[Project] export');
			const zip = new JSZip();

			const nodeAdd = (path, node) => {
				if (node.isDirectory) {
					zip.folder(path);
					node.childNodes.forEach(childNode => {
						nodeAdd( (path  ? path + '/': '') + childNode.title, childNode);
					});
				} else {
					zip.file(path, node.data);
				}
			};
			nodeAdd('', projectManager.project.model.data.struct.tree[0]);

			zip.generateAsync({type:"blob"}).then(function(content) {
				file.download(content, projectManager.project.model.data.struct.tree[0].title + '.zip');
			});
		}



		/**
		 * @description open file
		 * @param cfg
		 * @param cfg.path
		 * @param cfg.node
		 * @param cfg.parentNode
		 */
		fileOpen(cfg) {
			busEvent.fire('events.file.open', cfg);
		}

		/**
		 * @description create new file in directory
		 * @param cfg
		 * @param cfg.node
		 */
		fileCreate(cfg) {
			createFile({
				node: cfg.node,
				onCreate: (data) => {
					console.log('create in folder:', cfg, data);
					cfg.node.childNodes.push({
						ico: 'file_js',
						title: data.name,
						data: "",
						color: '#fff',
						isDirectory: false,
						isVisible: true
					});
				}
			});
		}

		/**
		 *
		 * @param cfg
		 * @param cfg.parentNode
		 * @param cfg.fileName
		 */
		fileDelete(cfg) {
			new Prompt({
				title: 'Delete',
				prompt: `Delete file ${cfg.fileName} ?`,
				yes: () => {
					const fileId = cfg.parentNode.childNodes.findIndex(item => item.title === cfg.fileName);
					cfg.parentNode.childNodes.splice(fileId, 1);
					busEvent.fire('events.file.delete', {fileName: cfg.fileName, path: cfg.path});
				}
			});
		}

		directoryCreate(cfg) {
			createDirectory({
				node: cfg.node,
				onCreate: (data) => {
					console.log('create in folder:', cfg, data);
					cfg.node.childNodes.push({
						ico: 'folder',
						title: data.name,
						color: '#fff',
						isDirectory: true,
						isVisible: true,
						isExpanded: true,
						childNodes: []
					});
				}
			});
		}

		directoryDelete(cfg) {
			new Prompt({
				title: 'Delete',
				prompt: `Delete directory ${cfg.fileName} with all files ?`,
				yes: () => {
					const fileId = cfg.parentNode.childNodes.findIndex(item => item.title === cfg.fileName);
					cfg.parentNode.childNodes.splice(fileId, 1);
					busEvent.fire('events.directory.delete', {fileName: cfg.fileName, path: cfg.path});
				}
			});
		}

		download() {
		}
	}


	const newProjectStruct = {
		tree: [
			{
				ico: 'project',
				title: 'newProject',
				color: '#fff',
				isDirectory: true,
				isVisible: true,
				isExpanded: true,
				childNodes: [
					{
						ico: 'file_js',
						title: 'app.js',
						data: "",
						color: '#fff',
						isDirectory: false,
						isVisible: true
					}
				]
			},
			{
				ico: 'project',
				title: 'External libraries',
				color: '#fff',
				isDirectory: true,
				isVisible: true,
				isExpanded: true,
				childNodes: []
			}
		],
		settings: {}
	};

	const projectManager = new (class ProjectManager {
		project;					//currentProject

		constructor() {
			busEvent.on("actions.project.create", () => {
				busEvent.fire("actions.panel.open", "projectInfo");
				this.create();
			});

			busEvent.on("actions.project.close", () => {
				this.close();
			});

			busEvent.on("events.project.change", () => {
				localStorage.setItem('currentProject', JSON.stringify(this.project.model.data.struct));
			});

			busEvent.on("actions.project.export", () => {
				this.export();
			});


			const currentProjectCfg = localStorage.getItem('currentProject');
			if (currentProjectCfg) {
				this.project = new Project(JSON.parse(currentProjectCfg));
				setTimeout(() => {		//TODO: replace by global onReady event
					busEvent.fire('actions.panel.open', 'projectInfo');
				}, 100);
			}
		}

		/**
		 * @description Open project from projData
		 * @param projData
		 * @returns {Promise}
		 */
		open(projData) {
			//console.log('[IdeProject] opening:', projectId);
			return new Promise(resolve => {
				alert("This functionality will be implemented in ms3");
				/*
				this.project = new Project(projData);
				busEvent.fire('events.project.change', this.project);
				busEvent.fire('actions.log.add', 'The project was opened');
				resolve(this.project);
				 */
			});
		}

		/**
		 * @description Create new project
		 * @returns {Promise}
		 */
		create() {
			return new Promise(resolve => {
				createProject({
					/**
					 * @param data	{Object}
					 * @param data	{Object}
					 */
					onCreate: (data) => {
						const projectStruct = Object.assign({}, newProjectStruct);
						projectStruct.tree[0].title = data.name;
						Object.assign(projectStruct, data);
						console.log('[PM] projectStruct:', projectStruct);
						this.project = new Project(projectStruct);
						//Add libs
						this.project.libAdd('@polkadot/api', 'polkadot_api.js').then(() => {});
						this.project.libAdd('@polkadot/util-crypto', 'polkadot_util-crypto.js').then(() => {});

						busEvent.fire('events.project.change', this.project);
						busEvent.fire('actions.log.add', 'New project has been created');
						resolve(this.project);
					}
				});
			});
		}

		/**
		 * @description Close project
		 */
		close() {
			busEvent.fire('events.project.change', undefined);
		}

		export() {
			if (this.project) {
				this.project.export();
			}
		}
	})();

	css$f.install();


	class IdePanelProjectInfo extends HTMLElement {
		tree;

		constructor() {
			super();

			this.init();
			busEvent.on('events.project.change', () => {
				this.init();
			});
		}

		init() {
			childNodesRemove(this);
			if (projectManager.project) {
				let $wrapper = new Tpl_projectInfo(
					{
						tree: projectManager.project.model.data.struct.tree
					}, {
						build: () => {
							projectManager.project.build();
						}
					}
				);
				$wrapper.model.bridgeChanges('tree', projectManager.project.model, 'struct.tree');
				this.appendChild($wrapper);

				$wrapper.querySelector('x-tree').configure({
					onDoubleClick: (path) => {
						if (path.match(/^External libraries\//)) {
							//console.log('open library:', path);
							return;
						}
						const nodeCfg = this.#getNodeByPath(path);
						projectManager.project.fileOpen(nodeCfg);
					},
					onContextMenu: (path) => {
						if (path.match(/^External libraries/)) {
							return;
						}
						const nodeCfg = this.#getNodeByPath(path);					// {node, parentNode, path}
						if (nodeCfg.node.isDirectory) {								//context menu for folders
							const menu = [
								{
									title: 'New file', action: ()=> {
										projectManager.project.fileCreate(nodeCfg);
									}
								},
								{
									title: 'New directory', action: () => {
										projectManager.project.directoryCreate(nodeCfg);
									}
								},
							];
							if (path.indexOf('/') !== -1) {
								menu.push({
									title: 'Delete', action: () => {
										projectManager.project.directoryDelete({parentNode: nodeCfg.parent, fileName: nodeCfg.node.title, path: path});
									}
								});
							}
							new ContextMenu(menu, {
								x: mouse.pageX,
								y: mouse.pageY
							});
						} else {													//context menu for files
							new ContextMenu([
								/*
								{
									title: 'Cut', action: ()=> {
										console.log('cut file, path:', path);
									}
								},
								 */
								{
									title: 'Delete', action: () => {
										projectManager.project.fileDelete({parentNode: nodeCfg.parent, fileName: nodeCfg.node.title, path: path});
									}
								}
							], {
								x: mouse.pageX,
								y: mouse.pageY
							});
						}
					}
				});
			} else {
				let $noProject = new Tpl_noProject({}, {
					open() {
						projectManager.open();
					},
					create() {
						//popup create
						projectManager.create().then(() => {

						});
					}
				});
				this.appendChild($noProject);
			}
		}

		#getNodeByPath(path) {
			const nodeNames = path.split('/');
			nodeNames.shift();													//remove project name from path
			return nodeNames.reduce((cfg, childName) => {
				return {
					parent: cfg.node,
					node: cfg.node.childNodes.find(item => item.title === childName),
					path: path
				};
			}, {node: projectManager.project.model.data.struct.tree[0]});
		}
	}

	customElements.define('x-ide-panel-projectinfo', IdePanelProjectInfo);

	let Tpl_network = class extends RP {
						constructor(model, logic) {
							const tree = {"vDom":{"tree":[{"type":"textNode","value":"The panel with network settings is planned to be implemented in the future"}]}};
							super(tree, model, logic);
						}
					};
					customElements.define('x-tpl_network', Tpl_network);

	const rules$8 = [{"selector":"x-ide-panel-network ","rule":"display: block;padding: 10px;"}];
				let cssStyle$8;
				const css$8 = {
					install:() => {
						cssStyle$8 = document.createElement("style");
						document.head.appendChild(cssStyle$8);
						const cssStyleSheet = cssStyle$8.sheet;
						rules$8.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/panels/network/network.css]:', rules);
					},
					remove:() => {
						if (cssStyle$8) {document.head.removeChild(cssStyle$8);}
					}
				};

	css$8.install();


	class IdePanelNetwork extends HTMLElement {
		constructor() {
			super();
			let $wrapper = new Tpl_network();
			this.appendChild($wrapper);
		}

		connectedCallback() {}
	}
	customElements.define('x-ide-panel-network', IdePanelNetwork);

	let Tpl_examples = class extends RP {
						constructor(model, logic) {
							const tree = {"vDom":{"tree":[{"type":"textNode","value":"Examples will be implemented in ms3"}]}};
							super(tree, model, logic);
						}
					};
					customElements.define('x-tpl_examples', Tpl_examples);

	const rules$7 = [{"selector":"x-ide-panel-examples ","rule":"display: block;padding: 10px;"}];
				let cssStyle$7;
				const css$7 = {
					install:() => {
						cssStyle$7 = document.createElement("style");
						document.head.appendChild(cssStyle$7);
						const cssStyleSheet = cssStyle$7.sheet;
						rules$7.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/panels/examples/examples.css]:', rules);
					},
					remove:() => {
						if (cssStyle$7) {document.head.removeChild(cssStyle$7);}
					}
				};

	css$7.install();


	class IdePanelExamples extends HTMLElement {
		constructor() {
			super();
			let $wrapper = new Tpl_examples();
			this.appendChild($wrapper);
		}

		connectedCallback() {}
	}
	customElements.define('x-ide-panel-examples', IdePanelExamples);

	let Tpl_console = class extends RP {
						constructor(model, logic) {
							const tree = {"vDom":{"tree":[{"type":"tag","tagName":"div","attrs":{"class":{"value":"menu icoQuiet","type":"string"}},"childNodes":[{"type":"tag","tagName":"item","attrs":{"name":{"value":"clear","type":"string"}},"childNodes":[{"type":"tag","tagName":"i","attrs":{"class":{"value":"ico remove","type":"string"}},"childNodes":[]}]},{"type":"tag","tagName":"item","attrs":{"name":{"value":"panelCollapse","type":"string"}},"childNodes":[{"type":"tag","tagName":"i","attrs":{"class":{"value":"ico collapse","type":"string"}},"childNodes":[]}]}]},{"type":"tag","tagName":"div","attrs":{"name":{"value":"log","type":"string"}},"childNodes":[]}]}};
							super(tree, model, logic);
						}
					};
					customElements.define('x-tpl_console', Tpl_console);

	const rules$6 = [{"selector":"x-ide-panel-console ","rule":"display: block;position: absolute;top: 0;bottom: 0;left: 0;right: 0;"},{"selector":"x-ide-panel-console div.menu ","rule":"text-align: right;"},{"selector":"x-ide-panel-console > * ","rule":"display: flex;flex-direction: column;height: 100%;"},{"selector":"x-ide-panel-console div[name='log'] ","rule":"display: block;flex: 1;overflow: auto;padding: 10px;box-sizing: border-box;background: var(--space-bg-color);"},{"selector":"x-ide-panel-console div[name='log'] > div ","rule":"display: table-row;margin-bottom: 10px;"},{"selector":"x-ide-panel-console div[name='log'] > div > * ","rule":"display: table-cell;"},{"selector":"x-ide-panel-console div[name='log'] > div > div.arrow ","rule":"color: gray;padding-left: 5px;padding-right: 10px;"}];
				let cssStyle$6;
				const css$6 = {
					install:() => {
						cssStyle$6 = document.createElement("style");
						document.head.appendChild(cssStyle$6);
						const cssStyleSheet = cssStyle$6.sheet;
						rules$6.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/panels/console/console.css]:', rules);
					},
					remove:() => {
						if (cssStyle$6) {document.head.removeChild(cssStyle$6);}
					}
				};

	const stringRepeat = function (obj, n) {
		let i;
		let str = '';
		if (!Number.is(n)) {
			throw new Error('x: must be a number');
		}
		for (i = 0; i < n; i++) {
			str += obj;
		}
		return str;
	};

	const sprintf = function (number, format) {
		number += '';
		format = format.replace(/%0*(.*)?d$/, '$1');
		number = stringRepeat('0', (format - number.length)) + number;
		return number;
	};

	Number.is = function (value) {
		return typeof value === 'number' && !isNaN(value);
	};

	/**
	 * @description return date by mask
	 * @param obj	{Date}
	 * @param mask	{String}
	 * @returns {String}
	 */
	const dateGet = (obj, mask) => {	// mask = 'dd m yyyy'
		if (!mask) {
			return obj.getFullYear() + '-' + sprintf((obj.getMonth() + 1), '%02d') + '-' + sprintf(obj.getDate(), '%02d');
		} else {
			return mask.replace(/(d+|M+|y+|h+|m+|s+)/g, function (reg, name) {
				let prop = {d: 'getDate', M: 'getMonth', y: 'getFullYear', h: 'getHours', m: 'getMinutes', s: 'getSeconds'}[name[0]];
				let value = obj[prop]();
				if (prop === 'getMonth') {
					value+=1;
				}
				return stringRepeat('0', name.length - (value + '').length) + value;
			});
		}
	};

	css$6.install();

	const logs = new ObjectLive({value: []});

	class IdePanelConsole extends HTMLElement {
		constructor($panel) {
			super();

			this.$wrapper = new Tpl_console({}, {
				panelCollapse: () => {
					$panelSpace.panelCollapse();
				}
			});
			this.appendChild(this.$wrapper);
			this.$logContainer = this.querySelector('div[name="log"]');

			this.querySelector('item[name="clear"]').addEventListener('click', () => {
				childNodesRemove(this.$logContainer);
			});
			this.querySelector('item[name="panelCollapse"]').addEventListener('click', () => {
				$panel.panelCollapse('console');
			});

			//render old logs
			logs.data.value.forEach(logRow => {
				this.logRowRender(logRow);
			});

			//subscribe on new logs
			logs.addEventListener('set', /^value\.[^.]+$/, (cfg) => {
				if (cfg.path !== "value.length") {
					this.logRowRender(cfg.newValue);
				}
			});
		}


		/**
		 * @description render log row
		 * @param cfg
		 * @param cfg.date		{Date}		//Date
		 * @param cfg.type		{String}	//enum(success,error,text) type of message
		 * @param cfg.text		{String}	//text
		 */
		logRowRender(cfg) {
			cfg.text += "";
			let color = {error: '#c1544e', warn: '#d9da27',  action: '#3f89fd', success: '#21b20b', text: 'var(----body-text-color)'}[cfg.type];
			let $msg = document.createElement('div');

			let $time = document.createElement('div');
			$time.innerHTML = dateGet(cfg.date, 'hh:mm:ss');
			$msg.appendChild($time);

			let $arrow = document.createElement('div');
			$arrow.innerHTML = '>';
			$arrow.className = 'arrow';
			$msg.appendChild($arrow);

			let $text = document.createElement('div');
			if (color) {
				$text.style.color = color;
			}
			$text.innerHTML = cfg.text.replace(/\n/g, '<br>');
			$msg.appendChild($text);
			this.$logContainer.appendChild($msg);
			this.$logContainer.scrollTo(0, this.scrollHeight);
		}

		static init() {
			busEvent.on('actions.log.add', e => {
				if (typeof e !== "object") {
					logs.data.value.push({text: e + "", date: new Date(), type: "text"});
				} else {
					logs.data.value.push(e);
				}
			});
		}
	}

	customElements.define('x-ide-panel-console', IdePanelConsole);

	let Tpl_find = class extends RP {
						constructor(model, logic) {
							const tree = {"vDom":{"tree":[{"type":"textNode","value":"Search across all project files will be implemented in ms3"}]}};
							super(tree, model, logic);
						}
					};
					customElements.define('x-tpl_find', Tpl_find);

	const rules$5 = [{"selector":"x-ide-panel-find ","rule":"display: block;padding: 10px;"}];
				let cssStyle$5;
				const css$5 = {
					install:() => {
						cssStyle$5 = document.createElement("style");
						document.head.appendChild(cssStyle$5);
						const cssStyleSheet = cssStyle$5.sheet;
						rules$5.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/panels/find/find.css]:', rules);
					},
					remove:() => {
						if (cssStyle$5) {document.head.removeChild(cssStyle$5);}
					}
				};

	css$5.install();


	class IdePanelFind extends HTMLElement {
		constructor() {
			super();
			let $wrapper = new Tpl_find();
			this.appendChild($wrapper);
		}

		connectedCallback() {}
	}
	customElements.define('x-ide-panel-find', IdePanelFind);

	const rules$4 = [{"selector":"x-aceeditor ","rule":"display: flex;flex-direction: column;height: 100%;border-top: 1px solid var(--body-border-color);box-sizing: border-box;"}];
				let cssStyle$4;
				const css$4 = {
					install:() => {
						cssStyle$4 = document.createElement("style");
						document.head.appendChild(cssStyle$4);
						const cssStyleSheet = cssStyle$4.sheet;
						rules$4.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/ui/aceEditor/aceEditor.css]:', rules);
					},
					remove:() => {
						if (cssStyle$4) {document.head.removeChild(cssStyle$4);}
					}
				};

	var ace$2 = {exports: {}};

	(function (module, exports) {
	((function(){function o(n){var i=e;n&&(e[n]||(e[n]={}),i=e[n]);if(!i.define||!i.define.packaged)t.original=i.define,i.define=t,i.define.packaged=!0;if(!i.require||!i.require.packaged)r.original=i.require,i.require=r,i.require.packaged=!0;}var ACE_NAMESPACE = "ace",e=function(){return this}();!e&&typeof window!="undefined"&&(e=window);var t=function(e,n,r){if(typeof e!="string"){t.original?t.original.apply(this,arguments):(console.error("dropping module because define wasn't a string."),console.trace());return}arguments.length==2&&(r=n),t.modules[e]||(t.payloads[e]=r,t.modules[e]=null);};t.modules={},t.payloads={};var n=function(e,t,n){if(typeof t=="string"){var i=s(e,t);if(i!=undefined)return n&&n(),i}else if(Object.prototype.toString.call(t)==="[object Array]"){var o=[];for(var u=0,a=t.length;u<a;++u){var f=s(e,t[u]);if(f==undefined&&r.original)return;o.push(f);}return n&&n.apply(null,o)||!0}},r=function(e,t){var i=n("",e,t);return i==undefined&&r.original?r.original.apply(this,arguments):i},i=function(e,t){if(t.indexOf("!")!==-1){var n=t.split("!");return i(e,n[0])+"!"+i(e,n[1])}if(t.charAt(0)=="."){var r=e.split("/").slice(0,-1).join("/");t=r+"/"+t;while(t.indexOf(".")!==-1&&s!=t){var s=t;t=t.replace(/\/\.\//,"/").replace(/[^\/]+\/\.\.\//,"");}}return t},s=function(e,r){r=i(e,r);var s=t.modules[r];if(!s){s=t.payloads[r];if(typeof s=="function"){var o={},u={id:r,uri:"",exports:o,packaged:!0},a=function(e,t){return n(r,e,t)},f=s(a,o,u);o=f||u.exports,t.modules[r]=o,delete t.payloads[r];}s=t.modules[r]=o||s;}return s};o(ACE_NAMESPACE);}))(),ace.define("ace/lib/es6-shim",["require","exports","module"],function(e,t,n){function r(e,t,n){Object.defineProperty(e,t,{value:n,enumerable:!1,writable:!0,configurable:!0});}String.prototype.startsWith||r(String.prototype,"startsWith",function(e,t){return t=t||0,this.lastIndexOf(e,t)===t}),String.prototype.endsWith||r(String.prototype,"endsWith",function(e,t){var n=this;if(t===undefined||t>n.length)t=n.length;t-=e.length;var r=n.indexOf(e,t);return r!==-1&&r===t}),String.prototype.repeat||r(String.prototype,"repeat",function(e){var t="",n=this;while(e>0){e&1&&(t+=n);if(e>>=1)n+=n;}return t}),String.prototype.includes||r(String.prototype,"includes",function(e,t){return this.indexOf(e,t)!=-1}),Object.assign||(Object.assign=function(e){if(e===undefined||e===null)throw new TypeError("Cannot convert undefined or null to object");var t=Object(e);for(var n=1;n<arguments.length;n++){var r=arguments[n];r!==undefined&&r!==null&&Object.keys(r).forEach(function(e){t[e]=r[e];});}return t}),Object.values||(Object.values=function(e){return Object.keys(e).map(function(t){return e[t]})}),Array.prototype.find||r(Array.prototype,"find",function(e){var t=this.length,n=arguments[1];for(var r=0;r<t;r++){var i=this[r];if(e.call(n,i,r,this))return i}}),Array.prototype.findIndex||r(Array.prototype,"findIndex",function(e){var t=this.length,n=arguments[1];for(var r=0;r<t;r++){var i=this[r];if(e.call(n,i,r,this))return r}}),Array.prototype.includes||r(Array.prototype,"includes",function(e,t){return this.indexOf(e,t)!=-1}),Array.prototype.fill||r(Array.prototype,"fill",function(e){var t=this,n=t.length>>>0,r=arguments[1],i=r>>0,s=i<0?Math.max(n+i,0):Math.min(i,n),o=arguments[2],u=o===undefined?n:o>>0,a=u<0?Math.max(n+u,0):Math.min(u,n);while(s<a)t[s]=e,s++;return t}),Array.of||r(Array,"of",function(){return Array.prototype.slice.call(arguments)});}),ace.define("ace/lib/fixoldbrowsers",["require","exports","module","ace/lib/es6-shim"],function(e,t,n){e("./es6-shim");}),ace.define("ace/lib/deep_copy",["require","exports","module"],function(e,t,n){t.deepCopy=function r(e){if(typeof e!="object"||!e)return e;var t;if(Array.isArray(e)){t=[];for(var n=0;n<e.length;n++)t[n]=r(e[n]);return t}if(Object.prototype.toString.call(e)!=="[object Object]")return e;t={};for(var n in e)t[n]=r(e[n]);return t};}),ace.define("ace/lib/lang",["require","exports","module","ace/lib/deep_copy"],function(e,t,n){t.last=function(e){return e[e.length-1]},t.stringReverse=function(e){return e.split("").reverse().join("")},t.stringRepeat=function(e,t){var n="";while(t>0){t&1&&(n+=e);if(t>>=1)e+=e;}return n};var r=/^\s\s*/,i=/\s\s*$/;t.stringTrimLeft=function(e){return e.replace(r,"")},t.stringTrimRight=function(e){return e.replace(i,"")},t.copyObject=function(e){var t={};for(var n in e)t[n]=e[n];return t},t.copyArray=function(e){var t=[];for(var n=0,r=e.length;n<r;n++)e[n]&&typeof e[n]=="object"?t[n]=this.copyObject(e[n]):t[n]=e[n];return t},t.deepCopy=e("./deep_copy").deepCopy,t.arrayToMap=function(e){var t={};for(var n=0;n<e.length;n++)t[e[n]]=1;return t},t.createMap=function(e){var t=Object.create(null);for(var n in e)t[n]=e[n];return t},t.arrayRemove=function(e,t){for(var n=0;n<=e.length;n++)t===e[n]&&e.splice(n,1);},t.escapeRegExp=function(e){return e.replace(/([.*+?^${}()|[\]\/\\])/g,"\\$1")},t.escapeHTML=function(e){return (""+e).replace(/&/g,"&#38;").replace(/"/g,"&#34;").replace(/'/g,"&#39;").replace(/</g,"&#60;")},t.getMatchOffsets=function(e,t){var n=[];return e.replace(t,function(e){n.push({offset:arguments[arguments.length-2],length:e.length});}),n},t.deferredCall=function(e){var t=null,n=function(){t=null,e();},r=function(e){return r.cancel(),t=setTimeout(n,e||0),r};return r.schedule=r,r.call=function(){return this.cancel(),e(),r},r.cancel=function(){return clearTimeout(t),t=null,r},r.isPending=function(){return t},r},t.delayedCall=function(e,t){var n=null,r=function(){n=null,e();},i=function(e){n==null&&(n=setTimeout(r,e||t));};return i.delay=function(e){n&&clearTimeout(n),n=setTimeout(r,e||t);},i.schedule=i,i.call=function(){this.cancel(),e();},i.cancel=function(){n&&clearTimeout(n),n=null;},i.isPending=function(){return n},i},t.supportsLookbehind=function(){try{new RegExp("(?<=.)");}catch(e){return !1}return !0},t.supportsUnicodeFlag=function(){try{new RegExp("^.$","u");}catch(e){return !1}return !0};}),ace.define("ace/lib/useragent",["require","exports","module"],function(e,t,n){t.OS={LINUX:"LINUX",MAC:"MAC",WINDOWS:"WINDOWS"},t.getOS=function(){return t.isMac?t.OS.MAC:t.isLinux?t.OS.LINUX:t.OS.WINDOWS};var r=typeof navigator=="object"?navigator:{},i=(/mac|win|linux/i.exec(r.platform)||["other"])[0].toLowerCase(),s=r.userAgent||"",o=r.appName||"";t.isWin=i=="win",t.isMac=i=="mac",t.isLinux=i=="linux",t.isIE=o=="Microsoft Internet Explorer"||o.indexOf("MSAppHost")>=0?parseFloat((s.match(/(?:MSIE |Trident\/[0-9]+[\.0-9]+;.*rv:)([0-9]+[\.0-9]+)/)||[])[1]):parseFloat((s.match(/(?:Trident\/[0-9]+[\.0-9]+;.*rv:)([0-9]+[\.0-9]+)/)||[])[1]),t.isOldIE=t.isIE&&t.isIE<9,t.isGecko=t.isMozilla=s.match(/ Gecko\/\d+/),t.isOpera=typeof opera=="object"&&Object.prototype.toString.call(window.opera)=="[object Opera]",t.isWebKit=parseFloat(s.split("WebKit/")[1])||undefined,t.isChrome=parseFloat(s.split(" Chrome/")[1])||undefined,t.isEdge=parseFloat(s.split(" Edge/")[1])||undefined,t.isAIR=s.indexOf("AdobeAIR")>=0,t.isAndroid=s.indexOf("Android")>=0,t.isChromeOS=s.indexOf(" CrOS ")>=0,t.isIOS=/iPad|iPhone|iPod/.test(s)&&!window.MSStream,t.isIOS&&(t.isMac=!0),t.isMobile=t.isIOS||t.isAndroid;}),ace.define("ace/lib/dom",["require","exports","module","ace/lib/useragent"],function(e,t,n){function u(){var e=o;o=null,e&&e.forEach(function(e){a(e[0],e[1]);});}function a(e,n,r){if(typeof document=="undefined")return;if(o)if(r)u();else if(r===!1)return o.push([e,n]);if(s)return;var i=r;if(!r||!r.getRootNode)i=document;else {i=r.getRootNode();if(!i||i==r)i=document;}var a=i.ownerDocument||i;if(n&&t.hasCssString(n,i))return null;n&&(e+="\n/*# sourceURL=ace/css/"+n+" */");var f=t.createElement("style");f.appendChild(a.createTextNode(e)),n&&(f.id=n),i==a&&(i=t.getDocumentHead(a)),i.insertBefore(f,i.firstChild);}var r=e("./useragent"),i="http://www.w3.org/1999/xhtml";t.buildDom=function l(e,t,n){if(typeof e=="string"&&e){var r=document.createTextNode(e);return t&&t.appendChild(r),r}if(!Array.isArray(e))return e&&e.appendChild&&t&&t.appendChild(e),e;if(typeof e[0]!="string"||!e[0]){var i=[];for(var s=0;s<e.length;s++){var o=l(e[s],t,n);o&&i.push(o);}return i}var u=document.createElement(e[0]),a=e[1],f=1;a&&typeof a=="object"&&!Array.isArray(a)&&(f=2);for(var s=f;s<e.length;s++)l(e[s],u,n);return f==2&&Object.keys(a).forEach(function(e){var t=a[e];e==="class"?u.className=Array.isArray(t)?t.join(" "):t:typeof t=="function"||e=="value"||e[0]=="$"?u[e]=t:e==="ref"?n&&(n[t]=u):e==="style"?typeof t=="string"&&(u.style.cssText=t):t!=null&&u.setAttribute(e,t);}),t&&t.appendChild(u),u},t.getDocumentHead=function(e){return e||(e=document),e.head||e.getElementsByTagName("head")[0]||e.documentElement},t.createElement=function(e,t){return document.createElementNS?document.createElementNS(t||i,e):document.createElement(e)},t.removeChildren=function(e){e.innerHTML="";},t.createTextNode=function(e,t){var n=t?t.ownerDocument:document;return n.createTextNode(e)},t.createFragment=function(e){var t=e?e.ownerDocument:document;return t.createDocumentFragment()},t.hasCssClass=function(e,t){var n=(e.className+"").split(/\s+/g);return n.indexOf(t)!==-1},t.addCssClass=function(e,n){t.hasCssClass(e,n)||(e.className+=" "+n);},t.removeCssClass=function(e,t){var n=e.className.split(/\s+/g);for(;;){var r=n.indexOf(t);if(r==-1)break;n.splice(r,1);}e.className=n.join(" ");},t.toggleCssClass=function(e,t){var n=e.className.split(/\s+/g),r=!0;for(;;){var i=n.indexOf(t);if(i==-1)break;r=!1,n.splice(i,1);}return r&&n.push(t),e.className=n.join(" "),r},t.setCssClass=function(e,n,r){r?t.addCssClass(e,n):t.removeCssClass(e,n);},t.hasCssString=function(e,t){var n=0,r;t=t||document;if(r=t.querySelectorAll("style"))while(n<r.length)if(r[n++].id===e)return !0},t.removeElementById=function(e,t){t=t||document,t.getElementById(e)&&t.getElementById(e).remove();};var s,o=[];t.useStrictCSP=function(e){s=e,e==0?u():o||(o=[]);},t.importCssString=a,t.importCssStylsheet=function(e,n){t.buildDom(["link",{rel:"stylesheet",href:e}],t.getDocumentHead(n));},t.scrollbarWidth=function(e){var n=t.createElement("ace_inner");n.style.width="100%",n.style.minWidth="0px",n.style.height="200px",n.style.display="block";var r=t.createElement("ace_outer"),i=r.style;i.position="absolute",i.left="-10000px",i.overflow="hidden",i.width="200px",i.minWidth="0px",i.height="150px",i.display="block",r.appendChild(n);var s=e&&e.documentElement||document&&document.documentElement;if(!s)return 0;s.appendChild(r);var o=n.offsetWidth;i.overflow="scroll";var u=n.offsetWidth;return o===u&&(u=r.clientWidth),s.removeChild(r),o-u},t.computedStyle=function(e,t){return window.getComputedStyle(e,"")||{}},t.setStyle=function(e,t,n){e[t]!==n&&(e[t]=n);},t.HAS_CSS_ANIMATION=!1,t.HAS_CSS_TRANSFORMS=!1,t.HI_DPI=r.isWin?typeof window!="undefined"&&window.devicePixelRatio>=1.5:!0,r.isChromeOS&&(t.HI_DPI=!1);if(typeof document!="undefined"){var f=document.createElement("div");t.HI_DPI&&f.style.transform!==undefined&&(t.HAS_CSS_TRANSFORMS=!0),!r.isEdge&&typeof f.style.animationName!="undefined"&&(t.HAS_CSS_ANIMATION=!0),f=null;}t.HAS_CSS_TRANSFORMS?t.translate=function(e,t,n){e.style.transform="translate("+Math.round(t)+"px, "+Math.round(n)+"px)";}:t.translate=function(e,t,n){e.style.top=Math.round(n)+"px",e.style.left=Math.round(t)+"px";};}),ace.define("ace/lib/net",["require","exports","module","ace/lib/dom"],function(e,t,n){var r=e("./dom");t.get=function(e,t){var n=new XMLHttpRequest;n.open("GET",e,!0),n.onreadystatechange=function(){n.readyState===4&&t(n.responseText);},n.send(null);},t.loadScript=function(e,t){var n=r.getDocumentHead(),i=document.createElement("script");i.src=e,n.appendChild(i),i.onload=i.onreadystatechange=function(e,n){if(n||!i.readyState||i.readyState=="loaded"||i.readyState=="complete")i=i.onload=i.onreadystatechange=null,n||t();};},t.qualifyURL=function(e){var t=document.createElement("a");return t.href=e,t.href};}),ace.define("ace/lib/oop",["require","exports","module"],function(e,t,n){t.inherits=function(e,t){e.super_=t,e.prototype=Object.create(t.prototype,{constructor:{value:e,enumerable:!1,writable:!0,configurable:!0}});},t.mixin=function(e,t){for(var n in t)e[n]=t[n];return e},t.implement=function(e,n){t.mixin(e,n);};}),ace.define("ace/lib/event_emitter",["require","exports","module"],function(e,t,n){var r={},i=function(){this.propagationStopped=!0;},s=function(){this.defaultPrevented=!0;};r._emit=r._dispatchEvent=function(e,t){this._eventRegistry||(this._eventRegistry={}),this._defaultHandlers||(this._defaultHandlers={});var n=this._eventRegistry[e]||[],r=this._defaultHandlers[e];if(!n.length&&!r)return;if(typeof t!="object"||!t)t={};t.type||(t.type=e),t.stopPropagation||(t.stopPropagation=i),t.preventDefault||(t.preventDefault=s),n=n.slice();for(var o=0;o<n.length;o++){n[o](t,this);if(t.propagationStopped)break}if(r&&!t.defaultPrevented)return r(t,this)},r._signal=function(e,t){var n=(this._eventRegistry||{})[e];if(!n)return;n=n.slice();for(var r=0;r<n.length;r++)n[r](t,this);},r.once=function(e,t){var n=this;this.on(e,function r(){n.off(e,r),t.apply(null,arguments);});if(!t)return new Promise(function(e){t=e;})},r.setDefaultHandler=function(e,t){var n=this._defaultHandlers;n||(n=this._defaultHandlers={_disabled_:{}});if(n[e]){var r=n[e],i=n._disabled_[e];i||(n._disabled_[e]=i=[]),i.push(r);var s=i.indexOf(t);s!=-1&&i.splice(s,1);}n[e]=t;},r.removeDefaultHandler=function(e,t){var n=this._defaultHandlers;if(!n)return;var r=n._disabled_[e];if(n[e]==t)r&&this.setDefaultHandler(e,r.pop());else if(r){var i=r.indexOf(t);i!=-1&&r.splice(i,1);}},r.on=r.addEventListener=function(e,t,n){this._eventRegistry=this._eventRegistry||{};var r=this._eventRegistry[e];return r||(r=this._eventRegistry[e]=[]),r.indexOf(t)==-1&&r[n?"unshift":"push"](t),t},r.off=r.removeListener=r.removeEventListener=function(e,t){this._eventRegistry=this._eventRegistry||{};var n=this._eventRegistry[e];if(!n)return;var r=n.indexOf(t);r!==-1&&n.splice(r,1);},r.removeAllListeners=function(e){e||(this._eventRegistry=this._defaultHandlers=undefined),this._eventRegistry&&(this._eventRegistry[e]=undefined),this._defaultHandlers&&(this._defaultHandlers[e]=undefined);},t.EventEmitter=r;}),ace.define("ace/lib/report_error",["require","exports","module"],function(e,t,n){t.reportError=function(t,n){var r=new Error(t);r.data=n,typeof console=="object"&&console.error&&console.error(r),setTimeout(function(){throw r});};}),ace.define("ace/lib/app_config",["require","exports","module","ace/lib/oop","ace/lib/event_emitter","ace/lib/report_error"],function(e,t,n){"no use strict";function u(e){typeof console!="undefined"&&console.warn&&console.warn.apply(console,arguments);}var r=e("./oop"),i=e("./event_emitter").EventEmitter,s=e("./report_error").reportError,o={setOptions:function(e){Object.keys(e).forEach(function(t){this.setOption(t,e[t]);},this);},getOptions:function(e){var t={};if(!e){var n=this.$options;e=Object.keys(n).filter(function(e){return !n[e].hidden});}else Array.isArray(e)||(t=e,e=Object.keys(t));return e.forEach(function(e){t[e]=this.getOption(e);},this),t},setOption:function(e,t){if(this["$"+e]===t)return;var n=this.$options[e];if(!n)return u('misspelled option "'+e+'"');if(n.forwardTo)return this[n.forwardTo]&&this[n.forwardTo].setOption(e,t);n.handlesSet||(this["$"+e]=t),n&&n.set&&n.set.call(this,t);},getOption:function(e){var t=this.$options[e];return t?t.forwardTo?this[t.forwardTo]&&this[t.forwardTo].getOption(e):t&&t.get?t.get.call(this):this["$"+e]:u('misspelled option "'+e+'"')}},a,f=function(){function e(){this.$defaultOptions={};}return e.prototype.defineOptions=function(e,t,n){return e.$options||(this.$defaultOptions[t]=e.$options={}),Object.keys(n).forEach(function(t){var r=n[t];typeof r=="string"&&(r={forwardTo:r}),r.name||(r.name=t),e.$options[r.name]=r,"initialValue"in r&&(e["$"+r.name]=r.initialValue);}),r.implement(e,o),this},e.prototype.resetOptions=function(e){Object.keys(e.$options).forEach(function(t){var n=e.$options[t];"value"in n&&e.setOption(t,n.value);});},e.prototype.setDefaultValue=function(e,t,n){if(!e){for(e in this.$defaultOptions)if(this.$defaultOptions[e][t])break;if(!this.$defaultOptions[e][t])return !1}var r=this.$defaultOptions[e]||(this.$defaultOptions[e]={});r[t]&&(r.forwardTo?this.setDefaultValue(r.forwardTo,t,n):r[t].value=n);},e.prototype.setDefaultValues=function(e,t){Object.keys(t).forEach(function(n){this.setDefaultValue(e,n,t[n]);},this);},e.prototype.setMessages=function(e){a=e;},e.prototype.nls=function(e,t){a&&!a[e]&&u("No message found for '"+e+"' in the provided messages, falling back to default English message.");var n=a&&a[e]||e;return t&&(n=n.replace(/\$(\$|[\d]+)/g,function(e,n){return n=="$"?"$":t[n]})),n},e}();f.prototype.warn=u,f.prototype.reportError=s,r.implement(f.prototype,i),t.AppConfig=f;}),ace.define("ace/theme/textmate-css",["require","exports","module"],function(e,t,n){n.exports='.ace-tm .ace_gutter {\n  background: #f0f0f0;\n  color: #333;\n}\n\n.ace-tm .ace_print-margin {\n  width: 1px;\n  background: #e8e8e8;\n}\n\n.ace-tm .ace_fold {\n    background-color: #6B72E6;\n}\n\n.ace-tm {\n  background-color: #FFFFFF;\n  color: black;\n}\n\n.ace-tm .ace_cursor {\n  color: black;\n}\n        \n.ace-tm .ace_invisible {\n  color: rgb(191, 191, 191);\n}\n\n.ace-tm .ace_storage,\n.ace-tm .ace_keyword {\n  color: blue;\n}\n\n.ace-tm .ace_constant {\n  color: rgb(197, 6, 11);\n}\n\n.ace-tm .ace_constant.ace_buildin {\n  color: rgb(88, 72, 246);\n}\n\n.ace-tm .ace_constant.ace_language {\n  color: rgb(88, 92, 246);\n}\n\n.ace-tm .ace_constant.ace_library {\n  color: rgb(6, 150, 14);\n}\n\n.ace-tm .ace_invalid {\n  background-color: rgba(255, 0, 0, 0.1);\n  color: red;\n}\n\n.ace-tm .ace_support.ace_function {\n  color: rgb(60, 76, 114);\n}\n\n.ace-tm .ace_support.ace_constant {\n  color: rgb(6, 150, 14);\n}\n\n.ace-tm .ace_support.ace_type,\n.ace-tm .ace_support.ace_class {\n  color: rgb(109, 121, 222);\n}\n\n.ace-tm .ace_keyword.ace_operator {\n  color: rgb(104, 118, 135);\n}\n\n.ace-tm .ace_string {\n  color: rgb(3, 106, 7);\n}\n\n.ace-tm .ace_comment {\n  color: rgb(76, 136, 107);\n}\n\n.ace-tm .ace_comment.ace_doc {\n  color: rgb(0, 102, 255);\n}\n\n.ace-tm .ace_comment.ace_doc.ace_tag {\n  color: rgb(128, 159, 191);\n}\n\n.ace-tm .ace_constant.ace_numeric {\n  color: rgb(0, 0, 205);\n}\n\n.ace-tm .ace_variable {\n  color: rgb(49, 132, 149);\n}\n\n.ace-tm .ace_xml-pe {\n  color: rgb(104, 104, 91);\n}\n\n.ace-tm .ace_entity.ace_name.ace_function {\n  color: #0000A2;\n}\n\n\n.ace-tm .ace_heading {\n  color: rgb(12, 7, 255);\n}\n\n.ace-tm .ace_list {\n  color:rgb(185, 6, 144);\n}\n\n.ace-tm .ace_meta.ace_tag {\n  color:rgb(0, 22, 142);\n}\n\n.ace-tm .ace_string.ace_regex {\n  color: rgb(255, 0, 0)\n}\n\n.ace-tm .ace_marker-layer .ace_selection {\n  background: rgb(181, 213, 255);\n}\n.ace-tm.ace_multiselect .ace_selection.ace_start {\n  box-shadow: 0 0 3px 0px white;\n}\n.ace-tm .ace_marker-layer .ace_step {\n  background: rgb(252, 255, 0);\n}\n\n.ace-tm .ace_marker-layer .ace_stack {\n  background: rgb(164, 229, 101);\n}\n\n.ace-tm .ace_marker-layer .ace_bracket {\n  margin: -1px 0 0 -1px;\n  border: 1px solid rgb(192, 192, 192);\n}\n\n.ace-tm .ace_marker-layer .ace_active-line {\n  background: rgba(0, 0, 0, 0.07);\n}\n\n.ace-tm .ace_gutter-active-line {\n    background-color : #dcdcdc;\n}\n\n.ace-tm .ace_marker-layer .ace_selected-word {\n  background: rgb(250, 250, 255);\n  border: 1px solid rgb(200, 200, 250);\n}\n\n.ace-tm .ace_indent-guide {\n  background: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAACCAYAAACZgbYnAAAAE0lEQVQImWP4////f4bLly//BwAmVgd1/w11/gAAAABJRU5ErkJggg==") right repeat-y;\n}\n\n.ace-tm .ace_indent-guide-active {\n  background: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAACCAYAAACZgbYnAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAIGNIUk0AAHolAACAgwAA+f8AAIDpAAB1MAAA6mAAADqYAAAXb5JfxUYAAAAZSURBVHjaYvj///9/hivKyv8BAAAA//8DACLqBhbvk+/eAAAAAElFTkSuQmCC") right repeat-y;\n}\n';}),ace.define("ace/theme/textmate",["require","exports","module","ace/theme/textmate-css","ace/lib/dom"],function(e,t,n){t.isDark=!1,t.cssClass="ace-tm",t.cssText=e("./textmate-css"),t.$id="ace/theme/textmate";var r=e("../lib/dom");r.importCssString(t.cssText,t.cssClass,!1);}),ace.define("ace/config",["require","exports","module","ace/lib/lang","ace/lib/net","ace/lib/dom","ace/lib/app_config","ace/theme/textmate"],function(e,t,n){"no use strict";var r=e("./lib/lang"),i=e("./lib/net"),s=e("./lib/dom"),o=e("./lib/app_config").AppConfig;n.exports=t=new o;var u={packaged:!1,workerPath:null,modePath:null,themePath:null,basePath:"",suffix:".js",$moduleUrls:{},loadWorkerFromBlob:!0,sharedPopups:!1,useStrictCSP:null};t.get=function(e){if(!u.hasOwnProperty(e))throw new Error("Unknown config key: "+e);return u[e]},t.set=function(e,t){if(u.hasOwnProperty(e))u[e]=t;else if(this.setDefaultValue("",e,t)==0)throw new Error("Unknown config key: "+e);e=="useStrictCSP"&&s.useStrictCSP(t);},t.all=function(){return r.copyObject(u)},t.$modes={},t.moduleUrl=function(e,t){if(u.$moduleUrls[e])return u.$moduleUrls[e];var n=e.split("/");t=t||n[n.length-2]||"";var r=t=="snippets"?"/":"-",i=n[n.length-1];if(t=="worker"&&r=="-"){var s=new RegExp("^"+t+"[\\-_]|[\\-_]"+t+"$","g");i=i.replace(s,"");}(!i||i==t)&&n.length>1&&(i=n[n.length-2]);var o=u[t+"Path"];return o==null?o=u.basePath:r=="/"&&(t=r=""),o&&o.slice(-1)!="/"&&(o+="/"),o+t+r+i+this.get("suffix")},t.setModuleUrl=function(e,t){return u.$moduleUrls[e]=t};var a=function(t,n){if(t==="ace/theme/textmate"||t==="./theme/textmate")return n(null,e("./theme/textmate"));if(f)return f(t,n);console.error("loader is not configured");},f;t.setLoader=function(e){f=e;},t.dynamicModules=Object.create(null),t.$loading={},t.$loaded={},t.loadModule=function(e,n){var r,s;Array.isArray(e)&&(s=e[0],e=e[1]);var o=function(r){if(r&&!t.$loading[e])return n&&n(r);t.$loading[e]||(t.$loading[e]=[]),t.$loading[e].push(n);if(t.$loading[e].length>1)return;var o=function(){a(e,function(n,r){r&&(t.$loaded[e]=r),t._emit("load.module",{name:e,module:r});var i=t.$loading[e];t.$loading[e]=null,i.forEach(function(e){e&&e(r);});});};if(!t.get("packaged"))return o();i.loadScript(t.moduleUrl(e,s),o),l();};if(t.dynamicModules[e])t.dynamicModules[e]().then(function(e){e.default?o(e.default):o(e);});else {try{r=this.$require(e);}catch(u){}o(r||t.$loaded[e]);}},t.$require=function(e){if(typeof n.require=="function"){var t="require";return n[t](e)}},t.setModuleLoader=function(e,n){t.dynamicModules[e]=n;};var l=function(){!u.basePath&&!u.workerPath&&!u.modePath&&!u.themePath&&!Object.keys(u.$moduleUrls).length&&(console.error("Unable to infer path to ace from script src,","use ace.config.set('basePath', 'path') to enable dynamic loading of modes and themes","or with webpack use ace/webpack-resolver"),l=function(){});};t.version="1.30.0";}),ace.define("ace/loader_build",["require","exports","module","ace/lib/fixoldbrowsers","ace/config"],function(e,t,n){function s(t){if(!i||!i.document)return;r.set("packaged",t||e.packaged||n.packaged||i.define&&undefined.packaged);var s={},u="",a=document.currentScript||document._currentScript,f=a&&a.ownerDocument||document;a&&a.src&&(u=a.src.split(/[?#]/)[0].split("/").slice(0,-1).join("/")||"");var l=f.getElementsByTagName("script");for(var c=0;c<l.length;c++){var h=l[c],p=h.src||h.getAttribute("src");if(!p)continue;var d=h.attributes;for(var v=0,m=d.length;v<m;v++){var g=d[v];g.name.indexOf("data-ace-")===0&&(s[o(g.name.replace(/^data-ace-/,""))]=g.value);}var y=p.match(/^(.*)\/ace([\-.]\w+)?\.js(\?|$)/);y&&(u=y[1]);}u&&(s.base=s.base||u,s.packaged=!0),s.basePath=s.base,s.workerPath=s.workerPath||s.base,s.modePath=s.modePath||s.base,s.themePath=s.themePath||s.base,delete s.base;for(var b in s)typeof s[b]!="undefined"&&r.set(b,s[b]);}function o(e){return e.replace(/-(.)/g,function(e,t){return t.toUpperCase()})}e("./lib/fixoldbrowsers");var r=e("./config");r.setLoader(function(t,n){e([t],function(e){n(null,e);});});var i=function(){return this||typeof window!="undefined"&&window}();n.exports=function(t){r.init=s,r.$require=e,t.require=e;};}),ace.define("ace/range",["require","exports","module"],function(e,t,n){var r=function(e,t){return e.row-t.row||e.column-t.column},i=function(){function e(e,t,n,r){this.start={row:e,column:t},this.end={row:n,column:r};}return e.prototype.isEqual=function(e){return this.start.row===e.start.row&&this.end.row===e.end.row&&this.start.column===e.start.column&&this.end.column===e.end.column},e.prototype.toString=function(){return "Range: ["+this.start.row+"/"+this.start.column+"] -> ["+this.end.row+"/"+this.end.column+"]"},e.prototype.contains=function(e,t){return this.compare(e,t)==0},e.prototype.compareRange=function(e){var t,n=e.end,r=e.start;return t=this.compare(n.row,n.column),t==1?(t=this.compare(r.row,r.column),t==1?2:t==0?1:0):t==-1?-2:(t=this.compare(r.row,r.column),t==-1?-1:t==1?42:0)},e.prototype.comparePoint=function(e){return this.compare(e.row,e.column)},e.prototype.containsRange=function(e){return this.comparePoint(e.start)==0&&this.comparePoint(e.end)==0},e.prototype.intersects=function(e){var t=this.compareRange(e);return t==-1||t==0||t==1},e.prototype.isEnd=function(e,t){return this.end.row==e&&this.end.column==t},e.prototype.isStart=function(e,t){return this.start.row==e&&this.start.column==t},e.prototype.setStart=function(e,t){typeof e=="object"?(this.start.column=e.column,this.start.row=e.row):(this.start.row=e,this.start.column=t);},e.prototype.setEnd=function(e,t){typeof e=="object"?(this.end.column=e.column,this.end.row=e.row):(this.end.row=e,this.end.column=t);},e.prototype.inside=function(e,t){return this.compare(e,t)==0?this.isEnd(e,t)||this.isStart(e,t)?!1:!0:!1},e.prototype.insideStart=function(e,t){return this.compare(e,t)==0?this.isEnd(e,t)?!1:!0:!1},e.prototype.insideEnd=function(e,t){return this.compare(e,t)==0?this.isStart(e,t)?!1:!0:!1},e.prototype.compare=function(e,t){return !this.isMultiLine()&&e===this.start.row?t<this.start.column?-1:t>this.end.column?1:0:e<this.start.row?-1:e>this.end.row?1:this.start.row===e?t>=this.start.column?0:-1:this.end.row===e?t<=this.end.column?0:1:0},e.prototype.compareStart=function(e,t){return this.start.row==e&&this.start.column==t?-1:this.compare(e,t)},e.prototype.compareEnd=function(e,t){return this.end.row==e&&this.end.column==t?1:this.compare(e,t)},e.prototype.compareInside=function(e,t){return this.end.row==e&&this.end.column==t?1:this.start.row==e&&this.start.column==t?-1:this.compare(e,t)},e.prototype.clipRows=function(t,n){if(this.end.row>n)var r={row:n+1,column:0};else if(this.end.row<t)var r={row:t,column:0};if(this.start.row>n)var i={row:n+1,column:0};else if(this.start.row<t)var i={row:t,column:0};return e.fromPoints(i||this.start,r||this.end)},e.prototype.extend=function(t,n){var r=this.compare(t,n);if(r==0)return this;if(r==-1)var i={row:t,column:n};else var s={row:t,column:n};return e.fromPoints(i||this.start,s||this.end)},e.prototype.isEmpty=function(){return this.start.row===this.end.row&&this.start.column===this.end.column},e.prototype.isMultiLine=function(){return this.start.row!==this.end.row},e.prototype.clone=function(){return e.fromPoints(this.start,this.end)},e.prototype.collapseRows=function(){return this.end.column==0?new e(this.start.row,0,Math.max(this.start.row,this.end.row-1),0):new e(this.start.row,0,this.end.row,0)},e.prototype.toScreenRange=function(t){var n=t.documentToScreenPosition(this.start),r=t.documentToScreenPosition(this.end);return new e(n.row,n.column,r.row,r.column)},e.prototype.moveBy=function(e,t){this.start.row+=e,this.start.column+=t,this.end.row+=e,this.end.column+=t;},e}();i.fromPoints=function(e,t){return new i(e.row,e.column,t.row,t.column)},i.comparePoints=r,i.comparePoints=function(e,t){return e.row-t.row||e.column-t.column},t.Range=i;}),ace.define("ace/lib/keys",["require","exports","module","ace/lib/oop"],function(e,t,n){var r=e("./oop"),i=function(){var e={MODIFIER_KEYS:{16:"Shift",17:"Ctrl",18:"Alt",224:"Meta",91:"MetaLeft",92:"MetaRight",93:"ContextMenu"},KEY_MODS:{ctrl:1,alt:2,option:2,shift:4,"super":8,meta:8,command:8,cmd:8,control:1},FUNCTION_KEYS:{8:"Backspace",9:"Tab",13:"Return",19:"Pause",27:"Esc",32:"Space",33:"PageUp",34:"PageDown",35:"End",36:"Home",37:"Left",38:"Up",39:"Right",40:"Down",44:"Print",45:"Insert",46:"Delete",96:"Numpad0",97:"Numpad1",98:"Numpad2",99:"Numpad3",100:"Numpad4",101:"Numpad5",102:"Numpad6",103:"Numpad7",104:"Numpad8",105:"Numpad9","-13":"NumpadEnter",112:"F1",113:"F2",114:"F3",115:"F4",116:"F5",117:"F6",118:"F7",119:"F8",120:"F9",121:"F10",122:"F11",123:"F12",144:"Numlock",145:"Scrolllock"},PRINTABLE_KEYS:{32:" ",48:"0",49:"1",50:"2",51:"3",52:"4",53:"5",54:"6",55:"7",56:"8",57:"9",59:";",61:"=",65:"a",66:"b",67:"c",68:"d",69:"e",70:"f",71:"g",72:"h",73:"i",74:"j",75:"k",76:"l",77:"m",78:"n",79:"o",80:"p",81:"q",82:"r",83:"s",84:"t",85:"u",86:"v",87:"w",88:"x",89:"y",90:"z",107:"+",109:"-",110:".",186:";",187:"=",188:",",189:"-",190:".",191:"/",192:"`",219:"[",220:"\\",221:"]",222:"'",111:"/",106:"*"}};e.PRINTABLE_KEYS[173]="-";var t,n;for(n in e.FUNCTION_KEYS)t=e.FUNCTION_KEYS[n].toLowerCase(),e[t]=parseInt(n,10);for(n in e.PRINTABLE_KEYS)t=e.PRINTABLE_KEYS[n].toLowerCase(),e[t]=parseInt(n,10);return r.mixin(e,e.MODIFIER_KEYS),r.mixin(e,e.PRINTABLE_KEYS),r.mixin(e,e.FUNCTION_KEYS),e.enter=e["return"],e.escape=e.esc,e.del=e["delete"],function(){var t=["cmd","ctrl","alt","shift"];for(var n=Math.pow(2,t.length);n--;)e.KEY_MODS[n]=t.filter(function(t){return n&e.KEY_MODS[t]}).join("-")+"-";}(),e.KEY_MODS[0]="",e.KEY_MODS[-1]="input-",e}();r.mixin(t,i),t.default=t,t.keyCodeToString=function(e){var t=i[e];return typeof t!="string"&&(t=String.fromCharCode(e)),t.toLowerCase()};}),ace.define("ace/lib/event",["require","exports","module","ace/lib/keys","ace/lib/useragent"],function(e,t,n){function a(){u=!1;try{document.createComment("").addEventListener("test",function(){},{get passive(){u={passive:!1};}});}catch(e){}}function f(){return u==undefined&&a(),u}function l(e,t,n){this.elem=e,this.type=t,this.callback=n;}function d(e,t,n){var u=p(t);if(!i.isMac&&s){t.getModifierState&&(t.getModifierState("OS")||t.getModifierState("Win"))&&(u|=8);if(s.altGr){if((3&u)==3)return;s.altGr=0;}if(n===18||n===17){var a="location"in t?t.location:t.keyLocation;if(n===17&&a===1)s[n]==1&&(o=t.timeStamp);else if(n===18&&u===3&&a===2){var f=t.timeStamp-o;f<50&&(s.altGr=!0);}}}n in r.MODIFIER_KEYS&&(n=-1);if(!u&&n===13){var a="location"in t?t.location:t.keyLocation;if(a===3){e(t,u,-n);if(t.defaultPrevented)return}}if(i.isChromeOS&&u&8){e(t,u,n);if(t.defaultPrevented)return;u&=-9;}return !!u||n in r.FUNCTION_KEYS||n in r.PRINTABLE_KEYS?e(t,u,n):!1}function v(){s=Object.create(null);}var r=e("./keys"),i=e("./useragent"),s=null,o=0,u;l.prototype.destroy=function(){h(this.elem,this.type,this.callback),this.elem=this.type=this.callback=undefined;};var c=t.addListener=function(e,t,n,r){e.addEventListener(t,n,f()),r&&r.$toDestroy.push(new l(e,t,n));},h=t.removeListener=function(e,t,n){e.removeEventListener(t,n,f());};t.stopEvent=function(e){return t.stopPropagation(e),t.preventDefault(e),!1},t.stopPropagation=function(e){e.stopPropagation&&e.stopPropagation();},t.preventDefault=function(e){e.preventDefault&&e.preventDefault();},t.getButton=function(e){return e.type=="dblclick"?0:e.type=="contextmenu"||i.isMac&&e.ctrlKey&&!e.altKey&&!e.shiftKey?2:e.button},t.capture=function(e,t,n){function i(e){t&&t(e),n&&n(e),h(r,"mousemove",t),h(r,"mouseup",i),h(r,"dragstart",i);}var r=e&&e.ownerDocument||document;return c(r,"mousemove",t),c(r,"mouseup",i),c(r,"dragstart",i),i},t.addMouseWheelListener=function(e,t,n){c(e,"wheel",function(e){var n=.15,r=e.deltaX||0,i=e.deltaY||0;switch(e.deltaMode){case e.DOM_DELTA_PIXEL:e.wheelX=r*n,e.wheelY=i*n;break;case e.DOM_DELTA_LINE:var s=15;e.wheelX=r*s,e.wheelY=i*s;break;case e.DOM_DELTA_PAGE:var o=150;e.wheelX=r*o,e.wheelY=i*o;}t(e);},n);},t.addMultiMouseDownListener=function(e,n,r,s,o){function p(e){t.getButton(e)!==0?u=0:e.detail>1?(u++,u>4&&(u=1)):u=1;if(i.isIE){var o=Math.abs(e.clientX-a)>5||Math.abs(e.clientY-f)>5;if(!l||o)u=1;l&&clearTimeout(l),l=setTimeout(function(){l=null;},n[u-1]||600),u==1&&(a=e.clientX,f=e.clientY);}e._clicks=u,r[s]("mousedown",e);if(u>4)u=0;else if(u>1)return r[s](h[u],e)}var u=0,a,f,l,h={2:"dblclick",3:"tripleclick",4:"quadclick"};Array.isArray(e)||(e=[e]),e.forEach(function(e){c(e,"mousedown",p,o);});};var p=function(e){return 0|(e.ctrlKey?1:0)|(e.altKey?2:0)|(e.shiftKey?4:0)|(e.metaKey?8:0)};t.getModifierString=function(e){return r.KEY_MODS[p(e)]},t.addCommandKeyListener=function(e,n,r){if(i.isOldGecko||i.isOpera&&!("KeyboardEvent"in window)){var o=null;c(e,"keydown",function(e){o=e.keyCode;},r),c(e,"keypress",function(e){return d(n,e,o)},r);}else {var u=null;c(e,"keydown",function(e){s[e.keyCode]=(s[e.keyCode]||0)+1;var t=d(n,e,e.keyCode);return u=e.defaultPrevented,t},r),c(e,"keypress",function(e){u&&(e.ctrlKey||e.altKey||e.shiftKey||e.metaKey)&&(t.stopEvent(e),u=null);},r),c(e,"keyup",function(e){s[e.keyCode]=null;},r),s||(v(),c(window,"focus",v));}};if(typeof window=="object"&&window.postMessage&&!i.isOldIE){var m=1;t.nextTick=function(e,n){n=n||window;var r="zero-timeout-message-"+m++,i=function(s){s.data==r&&(t.stopPropagation(s),h(n,"message",i),e());};c(n,"message",i),n.postMessage(r,"*");};}t.$idleBlocked=!1,t.onIdle=function(e,n){return setTimeout(function r(){t.$idleBlocked?setTimeout(r,100):e();},n)},t.$idleBlockId=null,t.blockIdle=function(e){t.$idleBlockId&&clearTimeout(t.$idleBlockId),t.$idleBlocked=!0,t.$idleBlockId=setTimeout(function(){t.$idleBlocked=!1;},e||100);},t.nextFrame=typeof window=="object"&&(window.requestAnimationFrame||window.mozRequestAnimationFrame||window.webkitRequestAnimationFrame||window.msRequestAnimationFrame||window.oRequestAnimationFrame),t.nextFrame?t.nextFrame=t.nextFrame.bind(window):t.nextFrame=function(e){setTimeout(e,17);};}),ace.define("ace/clipboard",["require","exports","module"],function(e,t,n){var r;n.exports={lineMode:!1,pasteCancelled:function(){return r&&r>Date.now()-50?!0:r=!1},cancel:function(){r=Date.now();}};}),ace.define("ace/keyboard/textinput",["require","exports","module","ace/lib/event","ace/config","ace/lib/useragent","ace/lib/dom","ace/lib/lang","ace/clipboard","ace/lib/keys"],function(e,t,n){var r=e("../lib/event"),i=e("../config").nls,s=e("../lib/useragent"),o=e("../lib/dom"),u=e("../lib/lang"),a=e("../clipboard"),f=s.isChrome<18,l=s.isIE,c=s.isChrome>63,h=400,p=e("../lib/keys"),d=p.KEY_MODS,v=s.isIOS,m=v?/\s/:/\n/,g=s.isMobile,y=function(e,t){function Q(){T=!0,n.blur(),n.focus(),T=!1;}function Y(e){e.keyCode==27&&n.value.length<n.selectionStart&&(w||(N=n.value),C=k=-1,H()),G();}function et(){clearTimeout(Z),Z=setTimeout(function(){S&&(n.style.cssText=S,S=""),t.renderer.$isMousePressed=!1,t.renderer.$keepTextAreaAtCursor&&t.renderer.$moveTextAreaToCursor();},0);}function nt(e,t,n){var r=null,i=!1;n.addEventListener("keydown",function(e){r&&clearTimeout(r),i=!0;},!0),n.addEventListener("keyup",function(e){r=setTimeout(function(){i=!1;},100);},!0);var s=function(e){if(document.activeElement!==n)return;if(i||w||t.$mouseHandler.isMousePressed)return;if(y)return;var r=n.selectionStart,s=n.selectionEnd,o=null,u=0;if(r==0)o=p.up;else if(r==1)o=p.home;else if(s>k&&N[s]=="\n")o=p.end;else if(r<C&&N[r-1]==" ")o=p.left,u=d.option;else if(r<C||r==C&&k!=C&&r==s)o=p.left;else if(s>k&&N.slice(0,s).split("\n").length>2)o=p.down;else if(s>k&&N[s-1]==" ")o=p.right,u=d.option;else if(s>k||s==k&&k!=C&&r==s)o=p.right;r!==s&&(u|=d.shift);if(o){var a=t.onCommandKey({},u,o);if(!a&&t.commands){o=p.keyCodeToString(o);var f=t.commands.findKeyCommand(u,o);f&&t.execCommand(f);}C=r,k=s,H("");}};document.addEventListener("selectionchange",s),t.on("destroy",function(){document.removeEventListener("selectionchange",s);});}var n=o.createElement("textarea");n.className="ace_text-input",n.setAttribute("wrap","off"),n.setAttribute("autocorrect","off"),n.setAttribute("autocapitalize","off"),n.setAttribute("spellcheck",!1),n.style.opacity="0",e.insertBefore(n,e.firstChild);var y=!1,b=!1,w=!1,E=!1,S="";g||(n.style.fontSize="1px");var x=!1,T=!1,N="",C=0,k=0,L=0,A=Number.MAX_SAFE_INTEGER,O=Number.MIN_SAFE_INTEGER,M=0;try{var _=document.activeElement===n;}catch(D){}this.setNumberOfExtraLines=function(e){A=Number.MAX_SAFE_INTEGER,O=Number.MIN_SAFE_INTEGER;if(e<0){M=0;return}M=e;},this.setAriaOptions=function(e){e.activeDescendant?(n.setAttribute("aria-haspopup","true"),n.setAttribute("aria-autocomplete",e.inline?"both":"list"),n.setAttribute("aria-activedescendant",e.activeDescendant)):(n.setAttribute("aria-haspopup","false"),n.setAttribute("aria-autocomplete","both"),n.removeAttribute("aria-activedescendant")),e.role&&n.setAttribute("role",e.role);if(e.setLabel){n.setAttribute("aria-roledescription",i("editor"));if(t.session){var r=t.session.selection.cursor.row;n.setAttribute("aria-label",i("Cursor at row $0",[r+1]));}}},this.setAriaOptions({role:"textbox"}),r.addListener(n,"blur",function(e){if(T)return;t.onBlur(e),_=!1;},t),r.addListener(n,"focus",function(e){if(T)return;_=!0;if(s.isEdge)try{if(!document.hasFocus())return}catch(e){}t.onFocus(e),s.isEdge?setTimeout(H):H();},t),this.$focusScroll=!1,this.focus=function(){this.setAriaOptions({setLabel:t.renderer.enableKeyboardAccessibility});if(S||c||this.$focusScroll=="browser")return n.focus({preventScroll:!0});var e=n.style.top;n.style.position="fixed",n.style.top="0px";try{var r=n.getBoundingClientRect().top!=0;}catch(i){return}var s=[];if(r){var o=n.parentElement;while(o&&o.nodeType==1)s.push(o),o.setAttribute("ace_nocontext",!0),!o.parentElement&&o.getRootNode?o=o.getRootNode().host:o=o.parentElement;}n.focus({preventScroll:!0}),r&&s.forEach(function(e){e.removeAttribute("ace_nocontext");}),setTimeout(function(){n.style.position="",n.style.top=="0px"&&(n.style.top=e);},0);},this.blur=function(){n.blur();},this.isFocused=function(){return _},t.on("beforeEndOperation",function(){var e=t.curOp,r=e&&e.command&&e.command.name;if(r=="insertstring")return;var i=r&&(e.docChanged||e.selectionChanged);w&&i&&(N=n.value="",K()),H();});var P=function(e,n){var r=n;for(var i=1;i<=e-A&&i<2*M+1;i++)r+=t.session.getLine(e-i).length+1;return r},H=v?function(e){if(!_||y&&!e||E)return;e||(e="");var r="\n ab"+e+"cde fg\n";r!=n.value&&(n.value=N=r);var i=4,s=4+(e.length||(t.selection.isEmpty()?0:1));(C!=i||k!=s)&&n.setSelectionRange(i,s),C=i,k=s;}:function(){if(w||E)return;if(!_&&!I)return;w=!0;var e=0,r=0,i="";if(t.session){var s=t.selection,o=s.getRange(),u=s.cursor.row;if(u===O+1)A=O+1,O=A+2*M;else if(u===A-1)O=A-1,A=O-2*M;else if(u<A-1||u>O+1)A=u>M?u-M:0,O=u>M?u+M:2*M;var a=[];for(var f=A;f<=O;f++)a.push(t.session.getLine(f));i=a.join("\n"),e=P(o.start.row,o.start.column),r=P(o.end.row,o.end.column);if(o.start.row<A){var l=t.session.getLine(A-1);e=o.start.row<A-1?0:e,r+=l.length+1,i=l+"\n"+i;}else if(o.end.row>O){var c=t.session.getLine(O+1);r=o.end.row>O+1?c.length:o.end.column,r+=i.length+1,i=i+"\n"+c;}else g&&u>0&&(i="\n"+i,r+=1,e+=1);i.length>h&&(e<h&&r<h?i=i.slice(0,h):(i="\n",e==r?e=r=0:(e=0,r=1)));var p=i+"\n\n";p!=N&&(n.value=N=p,C=k=p.length);}I&&(C=n.selectionStart,k=n.selectionEnd);if(k!=r||C!=e||n.selectionEnd!=k)try{n.setSelectionRange(e,r),C=e,k=r;}catch(d){}w=!1;};this.resetSelection=H,_&&t.onFocus();var B=function(e){return e.selectionStart===0&&e.selectionEnd>=N.length&&e.value===N&&N&&e.selectionEnd!==k},j=function(e){if(w)return;y?y=!1:B(n)?(t.selectAll(),H()):g&&n.selectionStart!=C&&H();},F=null;this.setInputHandler=function(e){F=e;},this.getInputHandler=function(){return F};var I=!1,q=function(e,r){I&&(I=!1);if(b)return H(),e&&t.onPaste(e),b=!1,"";var i=n.selectionStart,o=n.selectionEnd,u=C,a=N.length-k,f=e,l=e.length-i,c=e.length-o,h=0;while(u>0&&N[h]==e[h])h++,u--;f=f.slice(h),h=1;while(a>0&&N.length-h>C-1&&N[N.length-h]==e[e.length-h])h++,a--;l-=h-1,c-=h-1;var p=f.length-h+1;p<0&&(u=-p,p=0),f=f.slice(0,p);if(!r&&!f&&!l&&!u&&!a&&!c)return "";E=!0;var d=!1;return s.isAndroid&&f==". "&&(f="  ",d=!0),f&&!u&&!a&&!l&&!c||x?t.onTextInput(f):t.onTextInput(f,{extendLeft:u,extendRight:a,restoreStart:l,restoreEnd:c}),E=!1,N=e,C=i,k=o,L=c,d?"\n":f},R=function(e){if(w)return J();if(e&&e.inputType){if(e.inputType=="historyUndo")return t.execCommand("undo");if(e.inputType=="historyRedo")return t.execCommand("redo")}var r=n.value,i=q(r,!0);(r.length>h+100||m.test(i)||g&&C<1&&C==k)&&H();},U=function(e,t,n){var r=e.clipboardData||window.clipboardData;if(!r||f)return;var i=l||n?"Text":"text/plain";try{return t?r.setData(i,t)!==!1:r.getData(i)}catch(e){if(!n)return U(e,t,!0)}},z=function(e,i){var s=t.getCopyText();if(!s)return r.preventDefault(e);U(e,s)?(v&&(H(s),y=s,setTimeout(function(){y=!1;},10)),i?t.onCut():t.onCopy(),r.preventDefault(e)):(y=!0,n.value=s,n.select(),setTimeout(function(){y=!1,H(),i?t.onCut():t.onCopy();}));},W=function(e){z(e,!0);},X=function(e){z(e,!1);},V=function(e){var i=U(e);if(a.pasteCancelled())return;typeof i=="string"?(i&&t.onPaste(i,e),s.isIE&&setTimeout(H),r.preventDefault(e)):(n.value="",b=!0);};r.addCommandKeyListener(n,t.onCommandKey.bind(t),t),r.addListener(n,"select",j,t),r.addListener(n,"input",R,t),r.addListener(n,"cut",W,t),r.addListener(n,"copy",X,t),r.addListener(n,"paste",V,t),(!("oncut"in n)||!("oncopy"in n)||!("onpaste"in n))&&r.addListener(e,"keydown",function(e){if(s.isMac&&!e.metaKey||!e.ctrlKey)return;switch(e.keyCode){case 67:X(e);break;case 86:V(e);break;case 88:W(e);}},t);var $=function(e){if(w||!t.onCompositionStart||t.$readOnly)return;w={};if(x)return;e.data&&(w.useTextareaForIME=!1),setTimeout(J,0),t._signal("compositionStart"),t.on("mousedown",Q);var r=t.getSelectionRange();r.end.row=r.start.row,r.end.column=r.start.column,w.markerRange=r,w.selectionStart=C,t.onCompositionStart(w),w.useTextareaForIME?(N=n.value="",C=0,k=0):(n.msGetInputContext&&(w.context=n.msGetInputContext()),n.getInputContext&&(w.context=n.getInputContext()));},J=function(){if(!w||!t.onCompositionUpdate||t.$readOnly)return;if(x)return Q();if(w.useTextareaForIME)t.onCompositionUpdate(n.value);else {var e=n.value;q(e),w.markerRange&&(w.context&&(w.markerRange.start.column=w.selectionStart=w.context.compositionStartOffset),w.markerRange.end.column=w.markerRange.start.column+k-w.selectionStart+L);}},K=function(e){if(!t.onCompositionEnd||t.$readOnly)return;w=!1,t.onCompositionEnd(),t.off("mousedown",Q),e&&R();},G=u.delayedCall(J,50).schedule.bind(null,null);r.addListener(n,"compositionstart",$,t),r.addListener(n,"compositionupdate",J,t),r.addListener(n,"keyup",Y,t),r.addListener(n,"keydown",G,t),r.addListener(n,"compositionend",K,t),this.getElement=function(){return n},this.setCommandMode=function(e){x=e,n.readOnly=!1;},this.setReadOnly=function(e){x||(n.readOnly=e);},this.setCopyWithEmptySelection=function(e){},this.onContextMenu=function(e){I=!0,H(),t._emit("nativecontextmenu",{target:t,domEvent:e}),this.moveToMouse(e,!0);},this.moveToMouse=function(e,i){S||(S=n.style.cssText),n.style.cssText=(i?"z-index:100000;":"")+(s.isIE?"opacity:0.1;":"")+"text-indent: -"+(C+k)*t.renderer.characterWidth*.5+"px;";var u=t.container.getBoundingClientRect(),a=o.computedStyle(t.container),f=u.top+(parseInt(a.borderTopWidth)||0),l=u.left+(parseInt(u.borderLeftWidth)||0),c=u.bottom-f-n.clientHeight-2,h=function(e){o.translate(n,e.clientX-l-2,Math.min(e.clientY-f-2,c));};h(e);if(e.type!="mousedown")return;t.renderer.$isMousePressed=!0,clearTimeout(Z),s.isWin&&r.capture(t.container,h,et);},this.onContextMenuClose=et;var Z,tt=function(e){t.textInput.onContextMenu(e),et();};r.addListener(n,"mouseup",tt,t),r.addListener(n,"mousedown",function(e){e.preventDefault(),et();},t),r.addListener(t.renderer.scroller,"contextmenu",tt,t),r.addListener(n,"contextmenu",tt,t),v&&nt(e,t,n),this.destroy=function(){n.parentElement&&n.parentElement.removeChild(n);};};t.TextInput=y,t.$setUserAgentForTests=function(e,t){g=e,v=t;};}),ace.define("ace/mouse/default_handlers",["require","exports","module","ace/lib/useragent"],function(e,t,n){function u(e,t,n,r){return Math.sqrt(Math.pow(n-e,2)+Math.pow(r-t,2))}function a(e,t){if(e.start.row==e.end.row)var n=2*t.column-e.start.column-e.end.column;else if(e.start.row==e.end.row-1&&!e.start.column&&!e.end.column)var n=t.column-4;else var n=2*t.row-e.start.row-e.end.row;return n<0?{cursor:e.start,anchor:e.end}:{cursor:e.end,anchor:e.start}}var r=e("../lib/useragent"),i=0,s=550,o=function(){function e(e){e.$clickSelection=null;var t=e.editor;t.setDefaultHandler("mousedown",this.onMouseDown.bind(e)),t.setDefaultHandler("dblclick",this.onDoubleClick.bind(e)),t.setDefaultHandler("tripleclick",this.onTripleClick.bind(e)),t.setDefaultHandler("quadclick",this.onQuadClick.bind(e)),t.setDefaultHandler("mousewheel",this.onMouseWheel.bind(e));var n=["select","startSelect","selectEnd","selectAllEnd","selectByWordsEnd","selectByLinesEnd","dragWait","dragWaitEnd","focusWait"];n.forEach(function(t){e[t]=this[t];},this),e.selectByLines=this.extendSelectionBy.bind(e,"getLineRange"),e.selectByWords=this.extendSelectionBy.bind(e,"getWordRange");}return e.prototype.onMouseDown=function(e){var t=e.inSelection(),n=e.getDocumentPosition();this.mousedownEvent=e;var i=this.editor,s=e.getButton();if(s!==0){var o=i.getSelectionRange(),u=o.isEmpty();(u||s==1)&&i.selection.moveToPosition(n),s==2&&(i.textInput.onContextMenu(e.domEvent),r.isMozilla||e.preventDefault());return}this.mousedownEvent.time=Date.now();if(t&&!i.isFocused()){i.focus();if(this.$focusTimeout&&!this.$clickSelection&&!i.inMultiSelectMode){this.setState("focusWait"),this.captureMouse(e);return}}return this.captureMouse(e),this.startSelect(n,e.domEvent._clicks>1),e.preventDefault()},e.prototype.startSelect=function(e,t){e=e||this.editor.renderer.screenToTextCoordinates(this.x,this.y);var n=this.editor;if(!this.mousedownEvent)return;this.mousedownEvent.getShiftKey()?n.selection.selectToPosition(e):t||n.selection.moveToPosition(e),t||this.select(),n.setStyle("ace_selecting"),this.setState("select");},e.prototype.select=function(){var e,t=this.editor,n=t.renderer.screenToTextCoordinates(this.x,this.y);if(this.$clickSelection){var r=this.$clickSelection.comparePoint(n);if(r==-1)e=this.$clickSelection.end;else if(r==1)e=this.$clickSelection.start;else {var i=a(this.$clickSelection,n);n=i.cursor,e=i.anchor;}t.selection.setSelectionAnchor(e.row,e.column);}t.selection.selectToPosition(n),t.renderer.scrollCursorIntoView();},e.prototype.extendSelectionBy=function(e){var t,n=this.editor,r=n.renderer.screenToTextCoordinates(this.x,this.y),i=n.selection[e](r.row,r.column);if(this.$clickSelection){var s=this.$clickSelection.comparePoint(i.start),o=this.$clickSelection.comparePoint(i.end);if(s==-1&&o<=0){t=this.$clickSelection.end;if(i.end.row!=r.row||i.end.column!=r.column)r=i.start;}else if(o==1&&s>=0){t=this.$clickSelection.start;if(i.start.row!=r.row||i.start.column!=r.column)r=i.end;}else if(s==-1&&o==1)r=i.end,t=i.start;else {var u=a(this.$clickSelection,r);r=u.cursor,t=u.anchor;}n.selection.setSelectionAnchor(t.row,t.column);}n.selection.selectToPosition(r),n.renderer.scrollCursorIntoView();},e.prototype.selectByLinesEnd=function(){this.$clickSelection=null,this.editor.unsetStyle("ace_selecting");},e.prototype.focusWait=function(){var e=u(this.mousedownEvent.x,this.mousedownEvent.y,this.x,this.y),t=Date.now();(e>i||t-this.mousedownEvent.time>this.$focusTimeout)&&this.startSelect(this.mousedownEvent.getDocumentPosition());},e.prototype.onDoubleClick=function(e){var t=e.getDocumentPosition(),n=this.editor,r=n.session,i=r.getBracketRange(t);i?(i.isEmpty()&&(i.start.column--,i.end.column++),this.setState("select")):(i=n.selection.getWordRange(t.row,t.column),this.setState("selectByWords")),this.$clickSelection=i,this.select();},e.prototype.onTripleClick=function(e){var t=e.getDocumentPosition(),n=this.editor;this.setState("selectByLines");var r=n.getSelectionRange();r.isMultiLine()&&r.contains(t.row,t.column)?(this.$clickSelection=n.selection.getLineRange(r.start.row),this.$clickSelection.end=n.selection.getLineRange(r.end.row).end):this.$clickSelection=n.selection.getLineRange(t.row),this.select();},e.prototype.onQuadClick=function(e){var t=this.editor;t.selectAll(),this.$clickSelection=t.getSelectionRange(),this.setState("selectAll");},e.prototype.onMouseWheel=function(e){if(e.getAccelKey())return;e.getShiftKey()&&e.wheelY&&!e.wheelX&&(e.wheelX=e.wheelY,e.wheelY=0);var t=this.editor;this.$lastScroll||(this.$lastScroll={t:0,vx:0,vy:0,allowed:0});var n=this.$lastScroll,r=e.domEvent.timeStamp,i=r-n.t,o=i?e.wheelX/i:n.vx,u=i?e.wheelY/i:n.vy;i<s&&(o=(o+n.vx)/2,u=(u+n.vy)/2);var a=Math.abs(o/u),f=!1;a>=1&&t.renderer.isScrollableBy(e.wheelX*e.speed,0)&&(f=!0),a<=1&&t.renderer.isScrollableBy(0,e.wheelY*e.speed)&&(f=!0);if(f)n.allowed=r;else if(r-n.allowed<s){var l=Math.abs(o)<=1.5*Math.abs(n.vx)&&Math.abs(u)<=1.5*Math.abs(n.vy);l?(f=!0,n.allowed=r):n.allowed=0;}n.t=r,n.vx=o,n.vy=u;if(f)return t.renderer.scrollBy(e.wheelX*e.speed,e.wheelY*e.speed),e.stop()},e}();o.prototype.selectEnd=o.prototype.selectByLinesEnd,o.prototype.selectAllEnd=o.prototype.selectByLinesEnd,o.prototype.selectByWordsEnd=o.prototype.selectByLinesEnd,t.DefaultHandlers=o;}),ace.define("ace/tooltip",["require","exports","module","ace/lib/dom","ace/range"],function(e,t,n){var r=this&&this.__extends||function(){var e=function(t,n){return e=Object.setPrototypeOf||{__proto__:[]}instanceof Array&&function(e,t){e.__proto__=t;}||function(e,t){for(var n in t)Object.prototype.hasOwnProperty.call(t,n)&&(e[n]=t[n]);},e(t,n)};return function(t,n){function r(){this.constructor=t;}if(typeof n!="function"&&n!==null)throw new TypeError("Class extends value "+String(n)+" is not a constructor or null");e(t,n),t.prototype=n===null?Object.create(n):(r.prototype=n.prototype,new r);}}(),i=this&&this.__values||function(e){var t=typeof Symbol=="function"&&Symbol.iterator,n=t&&e[t],r=0;if(n)return n.call(e);if(e&&typeof e.length=="number")return {next:function(){return e&&r>=e.length&&(e=void 0),{value:e&&e[r++],done:!e}}};throw new TypeError(t?"Object is not iterable.":"Symbol.iterator is not defined.")},s=e("./lib/dom"),o=e("./range").Range,u="ace_tooltip",a=function(){function e(e){this.isOpen=!1,this.$element=null,this.$parentNode=e;}return e.prototype.$init=function(){return this.$element=s.createElement("div"),this.$element.className=u,this.$element.style.display="none",this.$parentNode.appendChild(this.$element),this.$element},e.prototype.getElement=function(){return this.$element||this.$init()},e.prototype.setText=function(e){this.getElement().textContent=e;},e.prototype.setHtml=function(e){this.getElement().innerHTML=e;},e.prototype.setPosition=function(e,t){this.getElement().style.left=e+"px",this.getElement().style.top=t+"px";},e.prototype.setClassName=function(e){s.addCssClass(this.getElement(),e);},e.prototype.setTheme=function(e){this.$element.className=u+" "+(e.isDark?"ace_dark ":"")+(e.cssClass||"");},e.prototype.show=function(e,t,n){e!=null&&this.setText(e),t!=null&&n!=null&&this.setPosition(t,n),this.isOpen||(this.getElement().style.display="block",this.isOpen=!0);},e.prototype.hide=function(){this.isOpen&&(this.getElement().style.display="none",this.getElement().className=u,this.isOpen=!1);},e.prototype.getHeight=function(){return this.getElement().offsetHeight},e.prototype.getWidth=function(){return this.getElement().offsetWidth},e.prototype.destroy=function(){this.isOpen=!1,this.$element&&this.$element.parentNode&&this.$element.parentNode.removeChild(this.$element);},e}(),f=function(){function e(){this.popups=[];}return e.prototype.addPopup=function(e){this.popups.push(e),this.updatePopups();},e.prototype.removePopup=function(e){var t=this.popups.indexOf(e);t!==-1&&(this.popups.splice(t,1),this.updatePopups());},e.prototype.updatePopups=function(){var e,t,n,r;this.popups.sort(function(e,t){return t.priority-e.priority});var s=[];try{for(var o=i(this.popups),u=o.next();!u.done;u=o.next()){var a=u.value,f=!0;try{for(var l=(n=void 0,i(s)),c=l.next();!c.done;c=l.next()){var h=c.value;if(this.doPopupsOverlap(h,a)){f=!1;break}}}catch(p){n={error:p};}finally{try{c&&!c.done&&(r=l.return)&&r.call(l);}finally{if(n)throw n.error}}f?s.push(a):a.hide();}}catch(d){e={error:d};}finally{try{u&&!u.done&&(t=o.return)&&t.call(o);}finally{if(e)throw e.error}}},e.prototype.doPopupsOverlap=function(e,t){var n=e.getElement().getBoundingClientRect(),r=t.getElement().getBoundingClientRect();return n.left<r.right&&n.right>r.left&&n.top<r.bottom&&n.bottom>r.top},e}(),l=new f;t.popupManager=l,t.Tooltip=a;var c=function(e){function t(t){t===void 0&&(t=document.body);var n=e.call(this,t)||this;n.timeout=undefined,n.lastT=0,n.idleTime=350,n.lastEvent=undefined,n.onMouseOut=n.onMouseOut.bind(n),n.onMouseMove=n.onMouseMove.bind(n),n.waitForHover=n.waitForHover.bind(n),n.hide=n.hide.bind(n);var r=n.getElement();return r.style.whiteSpace="pre-wrap",r.style.pointerEvents="auto",r.addEventListener("mouseout",n.onMouseOut),r.tabIndex=-1,r.addEventListener("blur",function(){r.contains(document.activeElement)||this.hide();}.bind(n)),n}return r(t,e),t.prototype.addToEditor=function(e){e.on("mousemove",this.onMouseMove),e.on("mousedown",this.hide),e.renderer.getMouseEventTarget().addEventListener("mouseout",this.onMouseOut,!0);},t.prototype.removeFromEditor=function(e){e.off("mousemove",this.onMouseMove),e.off("mousedown",this.hide),e.renderer.getMouseEventTarget().removeEventListener("mouseout",this.onMouseOut,!0),this.timeout&&(clearTimeout(this.timeout),this.timeout=null);},t.prototype.onMouseMove=function(e,t){this.lastEvent=e,this.lastT=Date.now();var n=t.$mouseHandler.isMousePressed;if(this.isOpen){var r=this.lastEvent&&this.lastEvent.getDocumentPosition();(!this.range||!this.range.contains(r.row,r.column)||n||this.isOutsideOfText(this.lastEvent))&&this.hide();}if(this.timeout||n)return;this.lastEvent=e,this.timeout=setTimeout(this.waitForHover,this.idleTime);},t.prototype.waitForHover=function(){this.timeout&&clearTimeout(this.timeout);var e=Date.now()-this.lastT;if(this.idleTime-e>10){this.timeout=setTimeout(this.waitForHover,this.idleTime-e);return}this.timeout=null,this.lastEvent&&!this.isOutsideOfText(this.lastEvent)&&this.$gatherData(this.lastEvent,this.lastEvent.editor);},t.prototype.isOutsideOfText=function(e){var t=e.editor,n=e.getDocumentPosition(),r=t.session.getLine(n.row);if(n.column==r.length){var i=t.renderer.pixelToScreenCoordinates(e.clientX,e.clientY),s=t.session.documentToScreenPosition(n.row,n.column);if(s.column!=i.column||s.row!=i.row)return !0}return !1},t.prototype.setDataProvider=function(e){this.$gatherData=e;},t.prototype.showForRange=function(e,t,n,r){if(r&&r!=this.lastEvent)return;if(this.isOpen&&document.activeElement==this.getElement())return;var i=e.renderer;this.isOpen||(l.addPopup(this),this.$registerCloseEvents(),this.setTheme(i.theme)),this.isOpen=!0,this.addMarker(t,e.session),this.range=o.fromPoints(t.start,t.end);var s=this.getElement();s.innerHTML="",s.appendChild(n),s.style.display="block";var u=i.textToScreenCoordinates(t.start.row,t.start.column),a=s.clientHeight,f=i.scroller.getBoundingClientRect(),c=!0;u.pageY-a<0&&(c=!1),c?u.pageY-=a:u.pageY+=i.lineHeight,s.style.maxWidth=f.width-(u.pageX-f.left)+"px",this.setPosition(u.pageX,u.pageY);},t.prototype.addMarker=function(e,t){this.marker&&this.$markerSession.removeMarker(this.marker),this.$markerSession=t,this.marker=t&&t.addMarker(e,"ace_highlight-marker","text");},t.prototype.hide=function(e){if(!e&&document.activeElement==this.getElement())return;if(e&&e.target&&(e.type!="keydown"||e.ctrlKey||e.metaKey)&&this.$element.contains(e.target))return;this.lastEvent=null,this.timeout&&clearTimeout(this.timeout),this.timeout=null,this.addMarker(null),this.isOpen&&(this.$removeCloseEvents(),this.getElement().style.display="none",this.isOpen=!1,l.removePopup(this));},t.prototype.$registerCloseEvents=function(){window.addEventListener("keydown",this.hide,!0),window.addEventListener("mousewheel",this.hide,!0),window.addEventListener("mousedown",this.hide,!0);},t.prototype.$removeCloseEvents=function(){window.removeEventListener("keydown",this.hide,!0),window.removeEventListener("mousewheel",this.hide,!0),window.removeEventListener("mousedown",this.hide,!0);},t.prototype.onMouseOut=function(e){this.timeout&&(clearTimeout(this.timeout),this.timeout=null),this.lastEvent=null;if(!this.isOpen)return;if(!e.relatedTarget||e.relatedTarget==this.getElement())return;if(e&&e.currentTarget.contains(e.relatedTarget))return;e.relatedTarget.classList.contains("ace_content")||this.hide();},t}(a);t.HoverTooltip=c;}),ace.define("ace/mouse/default_gutter_handler",["require","exports","module","ace/lib/dom","ace/lib/event","ace/tooltip","ace/config"],function(e,t,n){function f(e){function a(){var i=u.getDocumentPosition().row,s=t.session.getLength();if(i==s){var o=t.renderer.pixelToScreenCoordinates(0,u.y).row,a=u.$pos;if(o>t.session.documentToScreenRow(a.row,a.column))return f()}r.showTooltip(i);if(!r.isOpen)return;t.on("mousewheel",f);if(e.$tooltipFollowsMouse)c(u);else {var l=u.getGutterRow(),h=n.$lines.get(l);if(h){var p=h.element.querySelector(".ace_gutter_annotation"),d=p.getBoundingClientRect(),v=r.getElement().style;v.left=d.right+"px",v.top=d.bottom+"px";}else c(u);}}function f(){i&&(i=clearTimeout(i)),r.isOpen&&(r.hideTooltip(),t.off("mousewheel",f));}function c(e){r.setPosition(e.x,e.y);}var t=e.editor,n=t.renderer.$gutterLayer,r=new l(t);e.editor.setDefaultHandler("guttermousedown",function(r){if(!t.isFocused()||r.getButton()!=0)return;var i=n.getRegion(r);if(i=="foldWidgets")return;var s=r.getDocumentPosition().row,o=t.session.selection;if(r.getShiftKey())o.selectTo(s,0);else {if(r.domEvent.detail==2)return t.selectAll(),r.preventDefault();e.$clickSelection=t.selection.getLineRange(s);}return e.setState("selectByLines"),e.captureMouse(r),r.preventDefault()});var i,u;e.editor.setDefaultHandler("guttermousemove",function(t){var n=t.domEvent.target||t.domEvent.srcElement;if(s.hasCssClass(n,"ace_fold-widget"))return f();r.isOpen&&e.$tooltipFollowsMouse&&c(t),u=t;if(i)return;i=setTimeout(function(){i=null,u&&!e.isMousePressed?a():f();},50);}),o.addListener(t.renderer.$gutter,"mouseout",function(e){u=null;if(!r.isOpen||i)return;i=setTimeout(function(){i=null,f();},50);},t),t.on("changeSession",f),t.on("input",f);}var r=this&&this.__extends||function(){var e=function(t,n){return e=Object.setPrototypeOf||{__proto__:[]}instanceof Array&&function(e,t){e.__proto__=t;}||function(e,t){for(var n in t)Object.prototype.hasOwnProperty.call(t,n)&&(e[n]=t[n]);},e(t,n)};return function(t,n){function r(){this.constructor=t;}if(typeof n!="function"&&n!==null)throw new TypeError("Class extends value "+String(n)+" is not a constructor or null");e(t,n),t.prototype=n===null?Object.create(n):(r.prototype=n.prototype,new r);}}(),i=this&&this.__values||function(e){var t=typeof Symbol=="function"&&Symbol.iterator,n=t&&e[t],r=0;if(n)return n.call(e);if(e&&typeof e.length=="number")return {next:function(){return e&&r>=e.length&&(e=void 0),{value:e&&e[r++],done:!e}}};throw new TypeError(t?"Object is not iterable.":"Symbol.iterator is not defined.")},s=e("../lib/dom"),o=e("../lib/event"),u=e("../tooltip").Tooltip,a=e("../config").nls;t.GutterHandler=f;var l=function(e){function t(t){var n=e.call(this,t.container)||this;return n.editor=t,n}return r(t,e),t.prototype.setPosition=function(e,t){var n=window.innerWidth||document.documentElement.clientWidth,r=window.innerHeight||document.documentElement.clientHeight,i=this.getWidth(),s=this.getHeight();e+=15,t+=15,e+i>n&&(e-=e+i-n),t+s>r&&(t-=20+s),u.prototype.setPosition.call(this,e,t);},Object.defineProperty(t,"annotationLabels",{get:function(){return {error:{singular:a("error"),plural:a("errors")},warning:{singular:a("warning"),plural:a("warnings")},info:{singular:a("information message"),plural:a("information messages")}}},enumerable:!1,configurable:!0}),t.prototype.showTooltip=function(e){var n=this.editor.renderer.$gutterLayer,r=n.$annotations[e],i;r?i={text:Array.from(r.text),type:Array.from(r.type)}:i={text:[],type:[]};var s=n.session.getFoldLine(e);if(s&&n.$showFoldedAnnotations){var o={error:[],warning:[],info:[]},u;for(var a=e+1;a<=s.end.row;a++){if(!n.$annotations[a])continue;for(var f=0;f<n.$annotations[a].text.length;f++){var l=n.$annotations[a].type[f];o[l].push(n.$annotations[a].text[f]);if(l==="error"){u="error_fold";continue}if(l==="warning"){u="warning_fold";continue}}}if(u==="error_fold"||u==="warning_fold"){var c="".concat(t.annotationsToSummaryString(o)," in folded code.");i.text.push(c),i.type.push(u);}}if(i.text.length===0)return this.hide();var h={error:[],warning:[],info:[]},p=n.$useSvgGutterIcons?"ace_icon_svg":"ace_icon";for(var a=0;a<i.text.length;a++){var d="<span class='ace_".concat(i.type[a]," ").concat(p,"' aria-label='").concat(t.annotationLabels[i.type[a].replace("_fold","")].singular,"' role=img> </span> ").concat(i.text[a]);h[i.type[a].replace("_fold","")].push(d);}var v=[].concat(h.error,h.warning,h.info).join("<br>");this.setHtml(v),this.$element.setAttribute("aria-live","polite"),this.isOpen||(this.setTheme(this.editor.renderer.theme),this.setClassName("ace_gutter-tooltip")),this.show(),this.editor._signal("showGutterTooltip",this);},t.prototype.hideTooltip=function(){this.$element.removeAttribute("aria-live"),this.hide(),this.editor._signal("hideGutterTooltip",this);},t.annotationsToSummaryString=function(e){var n,r,s=[],o=["error","warning","info"];try{for(var u=i(o),a=u.next();!a.done;a=u.next()){var f=a.value;if(!e[f].length)continue;var l=e[f].length===1?t.annotationLabels[f].singular:t.annotationLabels[f].plural;s.push("".concat(e[f].length," ").concat(l));}}catch(c){n={error:c};}finally{try{a&&!a.done&&(r=u.return)&&r.call(u);}finally{if(n)throw n.error}}return s.join(", ")},t}(u);t.GutterTooltip=l;}),ace.define("ace/mouse/mouse_event",["require","exports","module","ace/lib/event","ace/lib/useragent"],function(e,t,n){var r=e("../lib/event"),i=e("../lib/useragent"),s=function(){function e(e,t){this.domEvent=e,this.editor=t,this.x=this.clientX=e.clientX,this.y=this.clientY=e.clientY,this.$pos=null,this.$inSelection=null,this.propagationStopped=!1,this.defaultPrevented=!1;}return e.prototype.stopPropagation=function(){r.stopPropagation(this.domEvent),this.propagationStopped=!0;},e.prototype.preventDefault=function(){r.preventDefault(this.domEvent),this.defaultPrevented=!0;},e.prototype.stop=function(){this.stopPropagation(),this.preventDefault();},e.prototype.getDocumentPosition=function(){return this.$pos?this.$pos:(this.$pos=this.editor.renderer.screenToTextCoordinates(this.clientX,this.clientY),this.$pos)},e.prototype.getGutterRow=function(){var e=this.getDocumentPosition().row,t=this.editor.session.documentToScreenRow(e,0),n=this.editor.session.documentToScreenRow(this.editor.renderer.$gutterLayer.$lines.get(0).row,0);return t-n},e.prototype.inSelection=function(){if(this.$inSelection!==null)return this.$inSelection;var e=this.editor,t=e.getSelectionRange();if(t.isEmpty())this.$inSelection=!1;else {var n=this.getDocumentPosition();this.$inSelection=t.contains(n.row,n.column);}return this.$inSelection},e.prototype.getButton=function(){return r.getButton(this.domEvent)},e.prototype.getShiftKey=function(){return this.domEvent.shiftKey},e.prototype.getAccelKey=function(){return i.isMac?this.domEvent.metaKey:this.domEvent.ctrlKey},e}();t.MouseEvent=s;}),ace.define("ace/mouse/dragdrop_handler",["require","exports","module","ace/lib/dom","ace/lib/event","ace/lib/useragent"],function(e,t,n){function f(e){function T(e,n){var r=Date.now(),i=!n||e.row!=n.row,s=!n||e.column!=n.column;if(!S||i||s)t.moveCursorToPosition(e),S=r,x={x:p,y:d};else {var o=l(x.x,x.y,p,d);o>a?S=null:r-S>=u&&(t.renderer.scrollCursorIntoView(),S=null);}}function N(e,n){var r=Date.now(),i=t.renderer.layerConfig.lineHeight,s=t.renderer.layerConfig.characterWidth,u=t.renderer.scroller.getBoundingClientRect(),a={x:{left:p-u.left,right:u.right-p},y:{top:d-u.top,bottom:u.bottom-d}},f=Math.min(a.x.left,a.x.right),l=Math.min(a.y.top,a.y.bottom),c={row:e.row,column:e.column};f/s<=2&&(c.column+=a.x.left<a.x.right?-3:2),l/i<=1&&(c.row+=a.y.top<a.y.bottom?-1:1);var h=e.row!=c.row,v=e.column!=c.column,m=!n||e.row!=n.row;h||v&&!m?E?r-E>=o&&t.renderer.scrollCursorIntoView(c):E=r:E=null;}function C(){var e=g;g=t.renderer.screenToTextCoordinates(p,d),T(g,e),N(g,e);}function k(){m=t.selection.toOrientedRange(),h=t.session.addMarker(m,"ace_selection",t.getSelectionStyle()),t.clearSelection(),t.isFocused()&&t.renderer.$cursorLayer.setBlinking(!1),clearInterval(v),C(),v=setInterval(C,20),y=0,i.addListener(document,"mousemove",O);}function L(){clearInterval(v),t.session.removeMarker(h),h=null,t.selection.fromOrientedRange(m),t.isFocused()&&!w&&t.$resetCursorStyle(),m=null,g=null,y=0,E=null,S=null,i.removeListener(document,"mousemove",O);}function O(){A==null&&(A=setTimeout(function(){A!=null&&h&&L();},20));}function M(e){var t=e.types;return !t||Array.prototype.some.call(t,function(e){return e=="text/plain"||e=="Text"})}function _(e){var t=["copy","copymove","all","uninitialized"],n=["move","copymove","linkmove","all","uninitialized"],r=s.isMac?e.altKey:e.ctrlKey,i="uninitialized";try{i=e.dataTransfer.effectAllowed.toLowerCase();}catch(e){}var o="none";return r&&t.indexOf(i)>=0?o="copy":n.indexOf(i)>=0?o="move":t.indexOf(i)>=0&&(o="copy"),o}var t=e.editor,n=r.createElement("div");n.style.cssText="top:-100px;position:absolute;z-index:2147483647;opacity:0.5",n.textContent="\u00a0";var f=["dragWait","dragWaitEnd","startDrag","dragReadyEnd","onMouseDrag"];f.forEach(function(t){e[t]=this[t];},this),t.on("mousedown",this.onMouseDown.bind(e));var c=t.container,h,p,d,v,m,g,y=0,b,w,E,S,x;this.onDragStart=function(e){if(this.cancelDrag||!c.draggable){var r=this;return setTimeout(function(){r.startSelect(),r.captureMouse(e);},0),e.preventDefault()}m=t.getSelectionRange();var i=e.dataTransfer;i.effectAllowed=t.getReadOnly()?"copy":"copyMove",t.container.appendChild(n),i.setDragImage&&i.setDragImage(n,0,0),setTimeout(function(){t.container.removeChild(n);}),i.clearData(),i.setData("Text",t.session.getTextRange()),w=!0,this.setState("drag");},this.onDragEnd=function(e){c.draggable=!1,w=!1,this.setState(null);if(!t.getReadOnly()){var n=e.dataTransfer.dropEffect;!b&&n=="move"&&t.session.remove(t.getSelectionRange()),t.$resetCursorStyle();}this.editor.unsetStyle("ace_dragging"),this.editor.renderer.setCursorStyle("");},this.onDragEnter=function(e){if(t.getReadOnly()||!M(e.dataTransfer))return;return p=e.clientX,d=e.clientY,h||k(),y++,e.dataTransfer.dropEffect=b=_(e),i.preventDefault(e)},this.onDragOver=function(e){if(t.getReadOnly()||!M(e.dataTransfer))return;return p=e.clientX,d=e.clientY,h||(k(),y++),A!==null&&(A=null),e.dataTransfer.dropEffect=b=_(e),i.preventDefault(e)},this.onDragLeave=function(e){y--;if(y<=0&&h)return L(),b=null,i.preventDefault(e)},this.onDrop=function(e){if(!g)return;var n=e.dataTransfer;if(w)switch(b){case"move":m.contains(g.row,g.column)?m={start:g,end:g}:m=t.moveText(m,g);break;case"copy":m=t.moveText(m,g,!0);}else {var r=n.getData("Text");m={start:g,end:t.session.insert(g,r)},t.focus(),b=null;}return L(),i.preventDefault(e)},i.addListener(c,"dragstart",this.onDragStart.bind(e),t),i.addListener(c,"dragend",this.onDragEnd.bind(e),t),i.addListener(c,"dragenter",this.onDragEnter.bind(e),t),i.addListener(c,"dragover",this.onDragOver.bind(e),t),i.addListener(c,"dragleave",this.onDragLeave.bind(e),t),i.addListener(c,"drop",this.onDrop.bind(e),t);var A=null;}function l(e,t,n,r){return Math.sqrt(Math.pow(n-e,2)+Math.pow(r-t,2))}var r=e("../lib/dom"),i=e("../lib/event"),s=e("../lib/useragent"),o=200,u=200,a=5;((function(){this.dragWait=function(){var e=Date.now()-this.mousedownEvent.time;e>this.editor.getDragDelay()&&this.startDrag();},this.dragWaitEnd=function(){var e=this.editor.container;e.draggable=!1,this.startSelect(this.mousedownEvent.getDocumentPosition()),this.selectEnd();},this.dragReadyEnd=function(e){this.editor.$resetCursorStyle(),this.editor.unsetStyle("ace_dragging"),this.editor.renderer.setCursorStyle(""),this.dragWaitEnd();},this.startDrag=function(){this.cancelDrag=!1;var e=this.editor,t=e.container;t.draggable=!0,e.renderer.$cursorLayer.setBlinking(!1),e.setStyle("ace_dragging");var n=s.isWin?"default":"move";e.renderer.setCursorStyle(n),this.setState("dragReady");},this.onMouseDrag=function(e){var t=this.editor.container;if(s.isIE&&this.state=="dragReady"){var n=l(this.mousedownEvent.x,this.mousedownEvent.y,this.x,this.y);n>3&&t.dragDrop();}if(this.state==="dragWait"){var n=l(this.mousedownEvent.x,this.mousedownEvent.y,this.x,this.y);n>0&&(t.draggable=!1,this.startSelect(this.mousedownEvent.getDocumentPosition()));}},this.onMouseDown=function(e){if(!this.$dragEnabled)return;this.mousedownEvent=e;var t=this.editor,n=e.inSelection(),r=e.getButton(),i=e.domEvent.detail||1;if(i===1&&r===0&&n){if(e.editor.inMultiSelectMode&&(e.getAccelKey()||e.getShiftKey()))return;this.mousedownEvent.time=Date.now();var o=e.domEvent.target||e.domEvent.srcElement;"unselectable"in o&&(o.unselectable="on");if(t.getDragDelay()){if(s.isWebKit){this.cancelDrag=!0;var u=t.container;u.draggable=!0;}this.setState("dragWait");}else this.startDrag();this.captureMouse(e,this.onMouseDrag.bind(this)),e.defaultPrevented=!0;}};})).call(f.prototype),t.DragdropHandler=f;}),ace.define("ace/mouse/touch_handler",["require","exports","module","ace/mouse/mouse_event","ace/lib/event","ace/lib/dom"],function(e,t,n){var r=e("./mouse_event").MouseEvent,i=e("../lib/event"),s=e("../lib/dom");t.addTouchListeners=function(e,t){function b(){var e=window.navigator&&window.navigator.clipboard,r=!1,i=function(){var n=t.getCopyText(),i=t.session.getUndoManager().hasUndo();y.replaceChild(s.buildDom(r?["span",!n&&["span",{"class":"ace_mobile-button",action:"selectall"},"Select All"],n&&["span",{"class":"ace_mobile-button",action:"copy"},"Copy"],n&&["span",{"class":"ace_mobile-button",action:"cut"},"Cut"],e&&["span",{"class":"ace_mobile-button",action:"paste"},"Paste"],i&&["span",{"class":"ace_mobile-button",action:"undo"},"Undo"],["span",{"class":"ace_mobile-button",action:"find"},"Find"],["span",{"class":"ace_mobile-button",action:"openCommandPallete"},"Palette"]]:["span"]),y.firstChild);},o=function(n){var s=n.target.getAttribute("action");if(s=="more"||!r)return r=!r,i();if(s=="paste")e.readText().then(function(e){t.execCommand(s,e);});else if(s){if(s=="cut"||s=="copy")e?e.writeText(t.getCopyText()):document.execCommand("copy");t.execCommand(s);}y.firstChild.style.display="none",r=!1,s!="openCommandPallete"&&t.focus();};y=s.buildDom(["div",{"class":"ace_mobile-menu",ontouchstart:function(e){n="menu",e.stopPropagation(),e.preventDefault(),t.textInput.focus();},ontouchend:function(e){e.stopPropagation(),e.preventDefault(),o(e);},onclick:o},["span"],["span",{"class":"ace_mobile-button",action:"more"},"..."]],t.container);}function w(){y||b();var e=t.selection.cursor,n=t.renderer.textToScreenCoordinates(e.row,e.column),r=t.renderer.textToScreenCoordinates(0,0).pageX,i=t.renderer.scrollLeft,s=t.container.getBoundingClientRect();y.style.top=n.pageY-s.top-3+"px",n.pageX-s.left<s.width-70?(y.style.left="",y.style.right="10px"):(y.style.right="",y.style.left=r+i-s.left+"px"),y.style.display="",y.firstChild.style.display="none",t.on("input",E);}function E(e){y&&(y.style.display="none"),t.off("input",E);}function S(){l=null,clearTimeout(l);var e=t.selection.getRange(),r=e.contains(p.row,p.column);if(e.isEmpty()||!r)t.selection.moveToPosition(p),t.selection.selectWord();n="wait",w();}function x(){l=null,clearTimeout(l),t.selection.moveToPosition(p);var e=d>=2?t.selection.getLineRange(p.row):t.session.getBracketRange(p);e&&!e.isEmpty()?t.selection.setRange(e):t.selection.selectWord(),n="wait";}function T(){h+=60,c=setInterval(function(){h--<=0&&(clearInterval(c),c=null),Math.abs(v)<.01&&(v=0),Math.abs(m)<.01&&(m=0),h<20&&(v=.9*v),h<20&&(m=.9*m);var e=t.session.getScrollTop();t.renderer.scrollBy(10*v,10*m),e==t.session.getScrollTop()&&(h=0);},10);}var n="scroll",o,u,a,f,l,c,h=0,p,d=0,v=0,m=0,g,y;i.addListener(e,"contextmenu",function(e){if(!g)return;var n=t.textInput.getElement();n.focus();},t),i.addListener(e,"touchstart",function(e){var i=e.touches;if(l||i.length>1){clearTimeout(l),l=null,a=-1,n="zoom";return}g=t.$mouseHandler.isMousePressed=!0;var s=t.renderer.layerConfig.lineHeight,c=t.renderer.layerConfig.lineHeight,y=e.timeStamp;f=y;var b=i[0],w=b.clientX,E=b.clientY;Math.abs(o-w)+Math.abs(u-E)>s&&(a=-1),o=e.clientX=w,u=e.clientY=E,v=m=0;var T=new r(e,t);p=T.getDocumentPosition();if(y-a<500&&i.length==1&&!h)d++,e.preventDefault(),e.button=0,x();else {d=0;var N=t.selection.cursor,C=t.selection.isEmpty()?N:t.selection.anchor,k=t.renderer.$cursorLayer.getPixelPosition(N,!0),L=t.renderer.$cursorLayer.getPixelPosition(C,!0),A=t.renderer.scroller.getBoundingClientRect(),O=t.renderer.layerConfig.offset,M=t.renderer.scrollLeft,_=function(e,t){return e/=c,t=t/s-.75,e*e+t*t};if(e.clientX<A.left){n="zoom";return}var D=_(e.clientX-A.left-k.left+M,e.clientY-A.top-k.top+O),P=_(e.clientX-A.left-L.left+M,e.clientY-A.top-L.top+O);D<3.5&&P<3.5&&(n=D>P?"cursor":"anchor"),P<3.5?n="anchor":D<3.5?n="cursor":n="scroll",l=setTimeout(S,450);}a=y;},t),i.addListener(e,"touchend",function(e){g=t.$mouseHandler.isMousePressed=!1,c&&clearInterval(c),n=="zoom"?(n="",h=0):l?(t.selection.moveToPosition(p),h=0,w()):n=="scroll"?(T(),E()):w(),clearTimeout(l),l=null;},t),i.addListener(e,"touchmove",function(e){l&&(clearTimeout(l),l=null);var i=e.touches;if(i.length>1||n=="zoom")return;var s=i[0],a=o-s.clientX,c=u-s.clientY;if(n=="wait"){if(!(a*a+c*c>4))return e.preventDefault();n="cursor";}o=s.clientX,u=s.clientY,e.clientX=s.clientX,e.clientY=s.clientY;var h=e.timeStamp,p=h-f;f=h;if(n=="scroll"){var d=new r(e,t);d.speed=1,d.wheelX=a,d.wheelY=c,10*Math.abs(a)<Math.abs(c)&&(a=0),10*Math.abs(c)<Math.abs(a)&&(c=0),p!=0&&(v=a/p,m=c/p),t._emit("mousewheel",d),d.propagationStopped||(v=m=0);}else {var g=new r(e,t),y=g.getDocumentPosition();n=="cursor"?t.selection.moveCursorToPosition(y):n=="anchor"&&t.selection.setSelectionAnchor(y.row,y.column),t.renderer.scrollCursorIntoView(y),e.preventDefault();}},t);};}),ace.define("ace/mouse/mouse_handler",["require","exports","module","ace/lib/event","ace/lib/useragent","ace/mouse/default_handlers","ace/mouse/default_gutter_handler","ace/mouse/mouse_event","ace/mouse/dragdrop_handler","ace/mouse/touch_handler","ace/config"],function(e,t,n){var r=e("../lib/event"),i=e("../lib/useragent"),s=e("./default_handlers").DefaultHandlers,o=e("./default_gutter_handler").GutterHandler,u=e("./mouse_event").MouseEvent,a=e("./dragdrop_handler").DragdropHandler,f=e("./touch_handler").addTouchListeners,l=e("../config"),c=function(){function e(e){var t=this;this.editor=e,new s(this),new o(this),new a(this);var n=function(t){var n=!document.hasFocus||!document.hasFocus()||!e.isFocused()&&document.activeElement==(e.textInput&&e.textInput.getElement());n&&window.focus(),e.focus(),setTimeout(function(){e.isFocused()||e.focus();});},u=e.renderer.getMouseEventTarget();r.addListener(u,"click",this.onMouseEvent.bind(this,"click"),e),r.addListener(u,"mousemove",this.onMouseMove.bind(this,"mousemove"),e),r.addMultiMouseDownListener([u,e.renderer.scrollBarV&&e.renderer.scrollBarV.inner,e.renderer.scrollBarH&&e.renderer.scrollBarH.inner,e.textInput&&e.textInput.getElement()].filter(Boolean),[400,300,250],this,"onMouseEvent",e),r.addMouseWheelListener(e.container,this.onMouseWheel.bind(this,"mousewheel"),e),f(e.container,e);var l=e.renderer.$gutter;r.addListener(l,"mousedown",this.onMouseEvent.bind(this,"guttermousedown"),e),r.addListener(l,"click",this.onMouseEvent.bind(this,"gutterclick"),e),r.addListener(l,"dblclick",this.onMouseEvent.bind(this,"gutterdblclick"),e),r.addListener(l,"mousemove",this.onMouseEvent.bind(this,"guttermousemove"),e),r.addListener(u,"mousedown",n,e),r.addListener(l,"mousedown",n,e),i.isIE&&e.renderer.scrollBarV&&(r.addListener(e.renderer.scrollBarV.element,"mousedown",n,e),r.addListener(e.renderer.scrollBarH.element,"mousedown",n,e)),e.on("mousemove",function(n){if(t.state||t.$dragDelay||!t.$dragEnabled)return;var r=e.renderer.screenToTextCoordinates(n.x,n.y),i=e.session.selection.getRange(),s=e.renderer;!i.isEmpty()&&i.insideStart(r.row,r.column)?s.setCursorStyle("default"):s.setCursorStyle("");},e);}return e.prototype.onMouseEvent=function(e,t){if(!this.editor.session)return;this.editor._emit(e,new u(t,this.editor));},e.prototype.onMouseMove=function(e,t){var n=this.editor._eventRegistry&&this.editor._eventRegistry.mousemove;if(!n||!n.length)return;this.editor._emit(e,new u(t,this.editor));},e.prototype.onMouseWheel=function(e,t){var n=new u(t,this.editor);n.speed=this.$scrollSpeed*2,n.wheelX=t.wheelX,n.wheelY=t.wheelY,this.editor._emit(e,n);},e.prototype.setState=function(e){this.state=e;},e.prototype.captureMouse=function(e,t){this.x=e.x,this.y=e.y,this.isMousePressed=!0;var n=this.editor,s=this.editor.renderer;s.$isMousePressed=!0;var o=this,a=function(e){if(!e)return;if(i.isWebKit&&!e.which&&o.releaseMouse)return o.releaseMouse();o.x=e.clientX,o.y=e.clientY,t&&t(e),o.mouseEvent=new u(e,o.editor),o.$mouseMoved=!0;},f=function(e){n.off("beforeEndOperation",c),clearInterval(h),n.session&&l(),o[o.state+"End"]&&o[o.state+"End"](e),o.state="",o.isMousePressed=s.$isMousePressed=!1,s.$keepTextAreaAtCursor&&s.$moveTextAreaToCursor(),o.$onCaptureMouseMove=o.releaseMouse=null,e&&o.onMouseEvent("mouseup",e),n.endOperation();},l=function(){o[o.state]&&o[o.state](),o.$mouseMoved=!1;};if(i.isOldIE&&e.domEvent.type=="dblclick")return setTimeout(function(){f(e);});var c=function(e){if(!o.releaseMouse)return;n.curOp.command.name&&n.curOp.selectionChanged&&(o[o.state+"End"]&&o[o.state+"End"](),o.state="",o.releaseMouse());};n.on("beforeEndOperation",c),n.startOperation({command:{name:"mouse"}}),o.$onCaptureMouseMove=a,o.releaseMouse=r.capture(this.editor.container,a,f);var h=setInterval(l,20);},e.prototype.cancelContextMenu=function(){var e=function(t){if(t&&t.domEvent&&t.domEvent.type!="contextmenu")return;this.editor.off("nativecontextmenu",e),t&&t.domEvent&&r.stopEvent(t.domEvent);}.bind(this);setTimeout(e,10),this.editor.on("nativecontextmenu",e);},e.prototype.destroy=function(){this.releaseMouse&&this.releaseMouse();},e}();c.prototype.releaseMouse=null,l.defineOptions(c.prototype,"mouseHandler",{scrollSpeed:{initialValue:2},dragDelay:{initialValue:i.isMac?150:0},dragEnabled:{initialValue:!0},focusTimeout:{initialValue:0},tooltipFollowsMouse:{initialValue:!0}}),t.MouseHandler=c;}),ace.define("ace/mouse/fold_handler",["require","exports","module","ace/lib/dom"],function(e,t,n){var r=e("../lib/dom"),i=function(){function e(e){e.on("click",function(t){var n=t.getDocumentPosition(),i=e.session,s=i.getFoldAt(n.row,n.column,1);s&&(t.getAccelKey()?i.removeFold(s):i.expandFold(s),t.stop());var o=t.domEvent&&t.domEvent.target;o&&r.hasCssClass(o,"ace_inline_button")&&r.hasCssClass(o,"ace_toggle_wrap")&&(i.setOption("wrap",!i.getUseWrapMode()),e.renderer.scrollCursorIntoView());}),e.on("gutterclick",function(t){var n=e.renderer.$gutterLayer.getRegion(t);if(n=="foldWidgets"){var r=t.getDocumentPosition().row,i=e.session;i.foldWidgets&&i.foldWidgets[r]&&e.session.onFoldWidgetClick(r,t),e.isFocused()||e.focus(),t.stop();}}),e.on("gutterdblclick",function(t){var n=e.renderer.$gutterLayer.getRegion(t);if(n=="foldWidgets"){var r=t.getDocumentPosition().row,i=e.session,s=i.getParentFoldRangeData(r,!0),o=s.range||s.firstRange;if(o){r=o.start.row;var u=i.getFoldAt(r,i.getLine(r).length,1);u?i.removeFold(u):(i.addFold("...",o),e.renderer.scrollCursorIntoView({row:o.start.row,column:0}));}t.stop();}});}return e}();t.FoldHandler=i;}),ace.define("ace/keyboard/keybinding",["require","exports","module","ace/lib/keys","ace/lib/event"],function(e,t,n){var r=e("../lib/keys"),i=e("../lib/event"),s=function(){function e(e){this.$editor=e,this.$data={editor:e},this.$handlers=[],this.setDefaultHandler(e.commands);}return e.prototype.setDefaultHandler=function(e){this.removeKeyboardHandler(this.$defaultHandler),this.$defaultHandler=e,this.addKeyboardHandler(e,0);},e.prototype.setKeyboardHandler=function(e){var t=this.$handlers;if(t[t.length-1]==e)return;while(t[t.length-1]&&t[t.length-1]!=this.$defaultHandler)this.removeKeyboardHandler(t[t.length-1]);this.addKeyboardHandler(e,1);},e.prototype.addKeyboardHandler=function(e,t){if(!e)return;typeof e=="function"&&!e.handleKeyboard&&(e.handleKeyboard=e);var n=this.$handlers.indexOf(e);n!=-1&&this.$handlers.splice(n,1),t==undefined?this.$handlers.push(e):this.$handlers.splice(t,0,e),n==-1&&e.attach&&e.attach(this.$editor);},e.prototype.removeKeyboardHandler=function(e){var t=this.$handlers.indexOf(e);return t==-1?!1:(this.$handlers.splice(t,1),e.detach&&e.detach(this.$editor),!0)},e.prototype.getKeyboardHandler=function(){return this.$handlers[this.$handlers.length-1]},e.prototype.getStatusText=function(){var e=this.$data,t=e.editor;return this.$handlers.map(function(n){return n.getStatusText&&n.getStatusText(t,e)||""}).filter(Boolean).join(" ")},e.prototype.$callKeyboardHandlers=function(e,t,n,r){var s,o=!1,u=this.$editor.commands;for(var a=this.$handlers.length;a--;){s=this.$handlers[a].handleKeyboard(this.$data,e,t,n,r);if(!s||!s.command)continue;s.command=="null"?o=!0:o=u.exec(s.command,this.$editor,s.args,r),o&&r&&e!=-1&&s.passEvent!=1&&s.command.passEvent!=1&&i.stopEvent(r);if(o)break}return !o&&e==-1&&(s={command:"insertstring"},o=u.exec("insertstring",this.$editor,t)),o&&this.$editor._signal&&this.$editor._signal("keyboardActivity",s),o},e.prototype.onCommandKey=function(e,t,n){var i=r.keyCodeToString(n);return this.$callKeyboardHandlers(t,i,n,e)},e.prototype.onTextInput=function(e){return this.$callKeyboardHandlers(-1,e)},e}();t.KeyBinding=s;}),ace.define("ace/lib/bidiutil",["require","exports","module"],function(e,t,n){function F(e,t,n,r){var i=s?d:p,c=null,h=null,v=null,m=0,g=null,y=null,b=-1,w=null,E=null,T=[];if(!r)for(w=0,r=[];w<n;w++)r[w]=R(e[w]);o=s,u=!1,f=!1,l=!1;for(E=0;E<n;E++){c=m,T[E]=h=q(e,r,T,E),m=i[c][h],g=m&240,m&=15,t[E]=v=i[m][5];if(g>0)if(g==16){for(w=b;w<E;w++)t[w]=1;b=-1;}else b=-1;y=i[m][6];if(y)b==-1&&(b=E);else if(b>-1){for(w=b;w<E;w++)t[w]=v;b=-1;}r[E]==S&&(t[E]=0),o|=v;}if(l)for(w=0;w<n;w++)if(r[w]==x){t[w]=s;for(var C=w-1;C>=0;C--){if(r[C]!=N)break;t[C]=s;}}}function I(e,t,n){if(o<e)return;if(e==1&&s==m&&!f){n.reverse();return}var r=n.length,i=0,u,a,l,c;while(i<r){if(t[i]>=e){u=i+1;while(u<r&&t[u]>=e)u++;for(a=i,l=u-1;a<l;a++,l--)c=n[a],n[a]=n[l],n[l]=c;i=u;}i++;}}function q(e,t,n,r){var i=t[r],o,c,h,p;switch(i){case g:case y:u=!1;case E:case w:return i;case b:return u?w:b;case T:return u=!0,y;case N:return E;case C:if(r<1||r+1>=t.length||(o=n[r-1])!=b&&o!=w||(c=t[r+1])!=b&&c!=w)return E;return u&&(c=w),c==o?c:E;case k:o=r>0?n[r-1]:S;if(o==b&&r+1<t.length&&t[r+1]==b)return b;return E;case L:if(r>0&&n[r-1]==b)return b;if(u)return E;p=r+1,h=t.length;while(p<h&&t[p]==L)p++;if(p<h&&t[p]==b)return b;return E;case A:h=t.length,p=r+1;while(p<h&&t[p]==A)p++;if(p<h){var d=e[r],v=d>=1425&&d<=2303||d==64286;o=t[p];if(v&&(o==y||o==T))return y}if(r<1||(o=t[r-1])==S)return E;return n[r-1];case S:return u=!1,f=!0,s;case x:return l=!0,E;case O:case M:case D:case P:case _:u=!1;case H:return E}}function R(e){var t=e.charCodeAt(0),n=t>>8;return n==0?t>191?g:B[t]:n==5?/[\u0591-\u05f4]/.test(e)?y:g:n==6?/[\u0610-\u061a\u064b-\u065f\u06d6-\u06e4\u06e7-\u06ed]/.test(e)?A:/[\u0660-\u0669\u066b-\u066c]/.test(e)?w:t==1642?L:/[\u06f0-\u06f9]/.test(e)?b:T:n==32&&t<=8287?j[t&255]:n==254?t>=65136?T:E:E}var s=0,o=0,u=!1,f=!1,l=!1,p=[[0,3,0,1,0,0,0],[0,3,0,1,2,2,0],[0,3,0,17,2,0,1],[0,3,5,5,4,1,0],[0,3,21,21,4,0,1],[0,3,5,5,4,2,0]],d=[[2,0,1,1,0,1,0],[2,0,1,1,0,2,0],[2,0,2,1,3,2,0],[2,0,2,33,3,1,1]],v=0,m=1,g=0,y=1,b=2,w=3,E=4,S=5,x=6,T=7,N=8,C=9,k=10,L=11,A=12,O=13,M=14,_=15,D=16,P=17,H=18,B=[H,H,H,H,H,H,H,H,H,x,S,x,N,S,H,H,H,H,H,H,H,H,H,H,H,H,H,H,S,S,S,x,N,E,E,L,L,L,E,E,E,E,E,k,C,k,C,C,b,b,b,b,b,b,b,b,b,b,C,E,E,E,E,E,E,g,g,g,g,g,g,g,g,g,g,g,g,g,g,g,g,g,g,g,g,g,g,g,g,g,g,E,E,E,E,E,E,g,g,g,g,g,g,g,g,g,g,g,g,g,g,g,g,g,g,g,g,g,g,g,g,g,g,E,E,E,E,H,H,H,H,H,H,S,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,H,C,E,L,L,L,L,E,E,E,E,g,E,E,H,E,E,L,L,b,b,E,g,E,E,E,b,g,E,E,E,E,E],j=[N,N,N,N,N,N,N,N,N,N,N,H,H,H,g,y,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,N,S,O,M,_,D,P,C,L,L,L,L,L,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,C,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,N];t.L=g,t.R=y,t.EN=b,t.ON_R=3,t.AN=4,t.R_H=5,t.B=6,t.RLE=7,t.DOT="\u00b7",t.doBidiReorder=function(e,n,r){if(e.length<2)return {};var i=e.split(""),o=new Array(i.length),u=new Array(i.length),a=[];s=r?m:v,F(i,a,i.length,n);for(var f=0;f<o.length;o[f]=f,f++);I(2,a,o),I(1,a,o);for(var f=0;f<o.length-1;f++)n[f]===w?a[f]=t.AN:a[f]===y&&(n[f]>T&&n[f]<O||n[f]===E||n[f]===H)?a[f]=t.ON_R:f>0&&i[f-1]==="\u0644"&&/\u0622|\u0623|\u0625|\u0627/.test(i[f])&&(a[f-1]=a[f]=t.R_H,f++);i[i.length-1]===t.DOT&&(a[i.length-1]=t.B),i[0]==="\u202b"&&(a[0]=t.RLE);for(var f=0;f<o.length;f++)u[f]=a[o[f]];return {logicalFromVisual:o,bidiLevels:u}},t.hasBidiCharacters=function(e,t){var n=!1;for(var r=0;r<e.length;r++)t[r]=R(e.charAt(r)),!n&&(t[r]==y||t[r]==T||t[r]==w)&&(n=!0);return n},t.getVisualFromLogicalIdx=function(e,t){for(var n=0;n<t.logicalFromVisual.length;n++)if(t.logicalFromVisual[n]==e)return n;return 0};}),ace.define("ace/bidihandler",["require","exports","module","ace/lib/bidiutil","ace/lib/lang"],function(e,t,n){var r=e("./lib/bidiutil"),i=e("./lib/lang"),s=/[\u0590-\u05f4\u0600-\u06ff\u0700-\u08ac\u202B]/,o=function(){function e(e){this.session=e,this.bidiMap={},this.currentRow=null,this.bidiUtil=r,this.charWidths=[],this.EOL="\u00ac",this.showInvisibles=!0,this.isRtlDir=!1,this.$isRtl=!1,this.line="",this.wrapIndent=0,this.EOF="\u00b6",this.RLE="\u202b",this.contentWidth=0,this.fontMetrics=null,this.rtlLineOffset=0,this.wrapOffset=0,this.isMoveLeftOperation=!1,this.seenBidi=s.test(e.getValue());}return e.prototype.isBidiRow=function(e,t,n){return this.seenBidi?(e!==this.currentRow&&(this.currentRow=e,this.updateRowLine(t,n),this.updateBidiMap()),this.bidiMap.bidiLevels):!1},e.prototype.onChange=function(e){this.seenBidi?this.currentRow=null:e.action=="insert"&&s.test(e.lines.join("\n"))&&(this.seenBidi=!0,this.currentRow=null);},e.prototype.getDocumentRow=function(){var e=0,t=this.session.$screenRowCache;if(t.length){var n=this.session.$getRowCacheIndex(t,this.currentRow);n>=0&&(e=this.session.$docRowCache[n]);}return e},e.prototype.getSplitIndex=function(){var e=0,t=this.session.$screenRowCache;if(t.length){var n,r=this.session.$getRowCacheIndex(t,this.currentRow);while(this.currentRow-e>0){n=this.session.$getRowCacheIndex(t,this.currentRow-e-1);if(n!==r)break;r=n,e++;}}else e=this.currentRow;return e},e.prototype.updateRowLine=function(e,t){e===undefined&&(e=this.getDocumentRow());var n=e===this.session.getLength()-1,s=n?this.EOF:this.EOL;this.wrapIndent=0,this.line=this.session.getLine(e),this.isRtlDir=this.$isRtl||this.line.charAt(0)===this.RLE;if(this.session.$useWrapMode){var o=this.session.$wrapData[e];o&&(t===undefined&&(t=this.getSplitIndex()),t>0&&o.length?(this.wrapIndent=o.indent,this.wrapOffset=this.wrapIndent*this.charWidths[r.L],this.line=t<o.length?this.line.substring(o[t-1],o[t]):this.line.substring(o[o.length-1])):this.line=this.line.substring(0,o[t]),t==o.length&&(this.line+=this.showInvisibles?s:r.DOT));}else this.line+=this.showInvisibles?s:r.DOT;var u=this.session,a=0,f;this.line=this.line.replace(/\t|[\u1100-\u2029, \u202F-\uFFE6]/g,function(e,t){return e==="	"||u.isFullWidth(e.charCodeAt(0))?(f=e==="	"?u.getScreenTabSize(t+a):2,a+=f-1,i.stringRepeat(r.DOT,f)):e}),this.isRtlDir&&(this.fontMetrics.$main.textContent=this.line.charAt(this.line.length-1)==r.DOT?this.line.substr(0,this.line.length-1):this.line,this.rtlLineOffset=this.contentWidth-this.fontMetrics.$main.getBoundingClientRect().width);},e.prototype.updateBidiMap=function(){var e=[];r.hasBidiCharacters(this.line,e)||this.isRtlDir?this.bidiMap=r.doBidiReorder(this.line,e,this.isRtlDir):this.bidiMap={};},e.prototype.markAsDirty=function(){this.currentRow=null;},e.prototype.updateCharacterWidths=function(e){if(this.characterWidth===e.$characterSize.width)return;this.fontMetrics=e;var t=this.characterWidth=e.$characterSize.width,n=e.$measureCharWidth("\u05d4");this.charWidths[r.L]=this.charWidths[r.EN]=this.charWidths[r.ON_R]=t,this.charWidths[r.R]=this.charWidths[r.AN]=n,this.charWidths[r.R_H]=n*.45,this.charWidths[r.B]=this.charWidths[r.RLE]=0,this.currentRow=null;},e.prototype.setShowInvisibles=function(e){this.showInvisibles=e,this.currentRow=null;},e.prototype.setEolChar=function(e){this.EOL=e;},e.prototype.setContentWidth=function(e){this.contentWidth=e;},e.prototype.isRtlLine=function(e){return this.$isRtl?!0:e!=undefined?this.session.getLine(e).charAt(0)==this.RLE:this.isRtlDir},e.prototype.setRtlDirection=function(e,t){var n=e.getCursorPosition();for(var r=e.selection.getSelectionAnchor().row;r<=n.row;r++)!t&&e.session.getLine(r).charAt(0)===e.session.$bidiHandler.RLE?e.session.doc.removeInLine(r,0,1):t&&e.session.getLine(r).charAt(0)!==e.session.$bidiHandler.RLE&&e.session.doc.insert({column:0,row:r},e.session.$bidiHandler.RLE);},e.prototype.getPosLeft=function(e){e-=this.wrapIndent;var t=this.line.charAt(0)===this.RLE?1:0,n=e>t?this.session.getOverwrite()?e:e-1:t,i=r.getVisualFromLogicalIdx(n,this.bidiMap),s=this.bidiMap.bidiLevels,o=0;!this.session.getOverwrite()&&e<=t&&s[i]%2!==0&&i++;for(var u=0;u<i;u++)o+=this.charWidths[s[u]];return !this.session.getOverwrite()&&e>t&&s[i]%2===0&&(o+=this.charWidths[s[i]]),this.wrapIndent&&(o+=this.isRtlDir?-1*this.wrapOffset:this.wrapOffset),this.isRtlDir&&(o+=this.rtlLineOffset),o},e.prototype.getSelections=function(e,t){var n=this.bidiMap,r=n.bidiLevels,i,s=[],o=0,u=Math.min(e,t)-this.wrapIndent,a=Math.max(e,t)-this.wrapIndent,f=!1,l=!1,c=0;this.wrapIndent&&(o+=this.isRtlDir?-1*this.wrapOffset:this.wrapOffset);for(var h,p=0;p<r.length;p++)h=n.logicalFromVisual[p],i=r[p],f=h>=u&&h<a,f&&!l?c=o:!f&&l&&s.push({left:c,width:o-c}),o+=this.charWidths[i],l=f;f&&p===r.length&&s.push({left:c,width:o-c});if(this.isRtlDir)for(var d=0;d<s.length;d++)s[d].left+=this.rtlLineOffset;return s},e.prototype.offsetToCol=function(e){this.isRtlDir&&(e-=this.rtlLineOffset);var t=0,e=Math.max(e,0),n=0,r=0,i=this.bidiMap.bidiLevels,s=this.charWidths[i[r]];this.wrapIndent&&(e-=this.isRtlDir?-1*this.wrapOffset:this.wrapOffset);while(e>n+s/2){n+=s;if(r===i.length-1){s=0;break}s=this.charWidths[i[++r]];}return r>0&&i[r-1]%2!==0&&i[r]%2===0?(e<n&&r--,t=this.bidiMap.logicalFromVisual[r]):r>0&&i[r-1]%2===0&&i[r]%2!==0?t=1+(e>n?this.bidiMap.logicalFromVisual[r]:this.bidiMap.logicalFromVisual[r-1]):this.isRtlDir&&r===i.length-1&&s===0&&i[r-1]%2===0||!this.isRtlDir&&r===0&&i[r]%2!==0?t=1+this.bidiMap.logicalFromVisual[r]:(r>0&&i[r-1]%2!==0&&s!==0&&r--,t=this.bidiMap.logicalFromVisual[r]),t===0&&this.isRtlDir&&t++,t+this.wrapIndent},e}();t.BidiHandler=o;}),ace.define("ace/selection",["require","exports","module","ace/lib/oop","ace/lib/lang","ace/lib/event_emitter","ace/range"],function(e,t,n){var r=e("./lib/oop"),i=e("./lib/lang"),s=e("./lib/event_emitter").EventEmitter,o=e("./range").Range,u=function(){function e(e){this.session=e,this.doc=e.getDocument(),this.clearSelection(),this.cursor=this.lead=this.doc.createAnchor(0,0),this.anchor=this.doc.createAnchor(0,0),this.$silent=!1;var t=this;this.cursor.on("change",function(e){t.$cursorChanged=!0,t.$silent||t._emit("changeCursor"),!t.$isEmpty&&!t.$silent&&t._emit("changeSelection"),!t.$keepDesiredColumnOnChange&&e.old.column!=e.value.column&&(t.$desiredColumn=null);}),this.anchor.on("change",function(){t.$anchorChanged=!0,!t.$isEmpty&&!t.$silent&&t._emit("changeSelection");});}return e.prototype.isEmpty=function(){return this.$isEmpty||this.anchor.row==this.lead.row&&this.anchor.column==this.lead.column},e.prototype.isMultiLine=function(){return !this.$isEmpty&&this.anchor.row!=this.cursor.row},e.prototype.getCursor=function(){return this.lead.getPosition()},e.prototype.setAnchor=function(e,t){this.$isEmpty=!1,this.anchor.setPosition(e,t);},e.prototype.getAnchor=function(){return this.$isEmpty?this.getSelectionLead():this.anchor.getPosition()},e.prototype.getSelectionLead=function(){return this.lead.getPosition()},e.prototype.isBackwards=function(){var e=this.anchor,t=this.lead;return e.row>t.row||e.row==t.row&&e.column>t.column},e.prototype.getRange=function(){var e=this.anchor,t=this.lead;return this.$isEmpty?o.fromPoints(t,t):this.isBackwards()?o.fromPoints(t,e):o.fromPoints(e,t)},e.prototype.clearSelection=function(){this.$isEmpty||(this.$isEmpty=!0,this._emit("changeSelection"));},e.prototype.selectAll=function(){this.$setSelection(0,0,Number.MAX_VALUE,Number.MAX_VALUE);},e.prototype.setRange=function(e,t){var n=t?e.end:e.start,r=t?e.start:e.end;this.$setSelection(n.row,n.column,r.row,r.column);},e.prototype.$setSelection=function(e,t,n,r){if(this.$silent)return;var i=this.$isEmpty,s=this.inMultiSelectMode;this.$silent=!0,this.$cursorChanged=this.$anchorChanged=!1,this.anchor.setPosition(e,t),this.cursor.setPosition(n,r),this.$isEmpty=!o.comparePoints(this.anchor,this.cursor),this.$silent=!1,this.$cursorChanged&&this._emit("changeCursor"),(this.$cursorChanged||this.$anchorChanged||i!=this.$isEmpty||s)&&this._emit("changeSelection");},e.prototype.$moveSelection=function(e){var t=this.lead;this.$isEmpty&&this.setSelectionAnchor(t.row,t.column),e.call(this);},e.prototype.selectTo=function(e,t){this.$moveSelection(function(){this.moveCursorTo(e,t);});},e.prototype.selectToPosition=function(e){this.$moveSelection(function(){this.moveCursorToPosition(e);});},e.prototype.moveTo=function(e,t){this.clearSelection(),this.moveCursorTo(e,t);},e.prototype.moveToPosition=function(e){this.clearSelection(),this.moveCursorToPosition(e);},e.prototype.selectUp=function(){this.$moveSelection(this.moveCursorUp);},e.prototype.selectDown=function(){this.$moveSelection(this.moveCursorDown);},e.prototype.selectRight=function(){this.$moveSelection(this.moveCursorRight);},e.prototype.selectLeft=function(){this.$moveSelection(this.moveCursorLeft);},e.prototype.selectLineStart=function(){this.$moveSelection(this.moveCursorLineStart);},e.prototype.selectLineEnd=function(){this.$moveSelection(this.moveCursorLineEnd);},e.prototype.selectFileEnd=function(){this.$moveSelection(this.moveCursorFileEnd);},e.prototype.selectFileStart=function(){this.$moveSelection(this.moveCursorFileStart);},e.prototype.selectWordRight=function(){this.$moveSelection(this.moveCursorWordRight);},e.prototype.selectWordLeft=function(){this.$moveSelection(this.moveCursorWordLeft);},e.prototype.getWordRange=function(e,t){if(typeof t=="undefined"){var n=e||this.lead;e=n.row,t=n.column;}return this.session.getWordRange(e,t)},e.prototype.selectWord=function(){this.setSelectionRange(this.getWordRange());},e.prototype.selectAWord=function(){var e=this.getCursor(),t=this.session.getAWordRange(e.row,e.column);this.setSelectionRange(t);},e.prototype.getLineRange=function(e,t){var n=typeof e=="number"?e:this.lead.row,r,i=this.session.getFoldLine(n);return i?(n=i.start.row,r=i.end.row):r=n,t===!0?new o(n,0,r,this.session.getLine(r).length):new o(n,0,r+1,0)},e.prototype.selectLine=function(){this.setSelectionRange(this.getLineRange());},e.prototype.moveCursorUp=function(){this.moveCursorBy(-1,0);},e.prototype.moveCursorDown=function(){this.moveCursorBy(1,0);},e.prototype.wouldMoveIntoSoftTab=function(e,t,n){var r=e.column,i=e.column+t;return n<0&&(r=e.column-t,i=e.column),this.session.isTabStop(e)&&this.doc.getLine(e.row).slice(r,i).split(" ").length-1==t},e.prototype.moveCursorLeft=function(){var e=this.lead.getPosition(),t;if(t=this.session.getFoldAt(e.row,e.column,-1))this.moveCursorTo(t.start.row,t.start.column);else if(e.column===0)e.row>0&&this.moveCursorTo(e.row-1,this.doc.getLine(e.row-1).length);else {var n=this.session.getTabSize();this.wouldMoveIntoSoftTab(e,n,-1)&&!this.session.getNavigateWithinSoftTabs()?this.moveCursorBy(0,-n):this.moveCursorBy(0,-1);}},e.prototype.moveCursorRight=function(){var e=this.lead.getPosition(),t;if(t=this.session.getFoldAt(e.row,e.column,1))this.moveCursorTo(t.end.row,t.end.column);else if(this.lead.column==this.doc.getLine(this.lead.row).length)this.lead.row<this.doc.getLength()-1&&this.moveCursorTo(this.lead.row+1,0);else {var n=this.session.getTabSize(),e=this.lead;this.wouldMoveIntoSoftTab(e,n,1)&&!this.session.getNavigateWithinSoftTabs()?this.moveCursorBy(0,n):this.moveCursorBy(0,1);}},e.prototype.moveCursorLineStart=function(){var e=this.lead.row,t=this.lead.column,n=this.session.documentToScreenRow(e,t),r=this.session.screenToDocumentPosition(n,0),i=this.session.getDisplayLine(e,null,r.row,r.column),s=i.match(/^\s*/);s[0].length!=t&&!this.session.$useEmacsStyleLineStart&&(r.column+=s[0].length),this.moveCursorToPosition(r);},e.prototype.moveCursorLineEnd=function(){var e=this.lead,t=this.session.getDocumentLastRowColumnPosition(e.row,e.column);if(this.lead.column==t.column){var n=this.session.getLine(t.row);if(t.column==n.length){var r=n.search(/\s+$/);r>0&&(t.column=r);}}this.moveCursorTo(t.row,t.column);},e.prototype.moveCursorFileEnd=function(){var e=this.doc.getLength()-1,t=this.doc.getLine(e).length;this.moveCursorTo(e,t);},e.prototype.moveCursorFileStart=function(){this.moveCursorTo(0,0);},e.prototype.moveCursorLongWordRight=function(){var e=this.lead.row,t=this.lead.column,n=this.doc.getLine(e),r=n.substring(t);this.session.nonTokenRe.lastIndex=0,this.session.tokenRe.lastIndex=0;var i=this.session.getFoldAt(e,t,1);if(i){this.moveCursorTo(i.end.row,i.end.column);return}this.session.nonTokenRe.exec(r)&&(t+=this.session.nonTokenRe.lastIndex,this.session.nonTokenRe.lastIndex=0,r=n.substring(t));if(t>=n.length){this.moveCursorTo(e,n.length),this.moveCursorRight(),e<this.doc.getLength()-1&&this.moveCursorWordRight();return}this.session.tokenRe.exec(r)&&(t+=this.session.tokenRe.lastIndex,this.session.tokenRe.lastIndex=0),this.moveCursorTo(e,t);},e.prototype.moveCursorLongWordLeft=function(){var e=this.lead.row,t=this.lead.column,n;if(n=this.session.getFoldAt(e,t,-1)){this.moveCursorTo(n.start.row,n.start.column);return}var r=this.session.getFoldStringAt(e,t,-1);r==null&&(r=this.doc.getLine(e).substring(0,t));var s=i.stringReverse(r);this.session.nonTokenRe.lastIndex=0,this.session.tokenRe.lastIndex=0,this.session.nonTokenRe.exec(s)&&(t-=this.session.nonTokenRe.lastIndex,s=s.slice(this.session.nonTokenRe.lastIndex),this.session.nonTokenRe.lastIndex=0);if(t<=0){this.moveCursorTo(e,0),this.moveCursorLeft(),e>0&&this.moveCursorWordLeft();return}this.session.tokenRe.exec(s)&&(t-=this.session.tokenRe.lastIndex,this.session.tokenRe.lastIndex=0),this.moveCursorTo(e,t);},e.prototype.$shortWordEndIndex=function(e){var t=0,n,r=/\s/,i=this.session.tokenRe;i.lastIndex=0;if(this.session.tokenRe.exec(e))t=this.session.tokenRe.lastIndex;else {while((n=e[t])&&r.test(n))t++;if(t<1){i.lastIndex=0;while((n=e[t])&&!i.test(n)){i.lastIndex=0,t++;if(r.test(n)){if(t>2){t--;break}while((n=e[t])&&r.test(n))t++;if(t>2)break}}}}return i.lastIndex=0,t},e.prototype.moveCursorShortWordRight=function(){var e=this.lead.row,t=this.lead.column,n=this.doc.getLine(e),r=n.substring(t),i=this.session.getFoldAt(e,t,1);if(i)return this.moveCursorTo(i.end.row,i.end.column);if(t==n.length){var s=this.doc.getLength();do e++,r=this.doc.getLine(e);while(e<s&&/^\s*$/.test(r));/^\s+/.test(r)||(r=""),t=0;}var o=this.$shortWordEndIndex(r);this.moveCursorTo(e,t+o);},e.prototype.moveCursorShortWordLeft=function(){var e=this.lead.row,t=this.lead.column,n;if(n=this.session.getFoldAt(e,t,-1))return this.moveCursorTo(n.start.row,n.start.column);var r=this.session.getLine(e).substring(0,t);if(t===0){do e--,r=this.doc.getLine(e);while(e>0&&/^\s*$/.test(r));t=r.length,/\s+$/.test(r)||(r="");}var s=i.stringReverse(r),o=this.$shortWordEndIndex(s);return this.moveCursorTo(e,t-o)},e.prototype.moveCursorWordRight=function(){this.session.$selectLongWords?this.moveCursorLongWordRight():this.moveCursorShortWordRight();},e.prototype.moveCursorWordLeft=function(){this.session.$selectLongWords?this.moveCursorLongWordLeft():this.moveCursorShortWordLeft();},e.prototype.moveCursorBy=function(e,t){var n=this.session.documentToScreenPosition(this.lead.row,this.lead.column),r;t===0&&(e!==0&&(this.session.$bidiHandler.isBidiRow(n.row,this.lead.row)?(r=this.session.$bidiHandler.getPosLeft(n.column),n.column=Math.round(r/this.session.$bidiHandler.charWidths[0])):r=n.column*this.session.$bidiHandler.charWidths[0]),this.$desiredColumn?n.column=this.$desiredColumn:this.$desiredColumn=n.column);if(e!=0&&this.session.lineWidgets&&this.session.lineWidgets[this.lead.row]){var i=this.session.lineWidgets[this.lead.row];e<0?e-=i.rowsAbove||0:e>0&&(e+=i.rowCount-(i.rowsAbove||0));}var s=this.session.screenToDocumentPosition(n.row+e,n.column,r);e!==0&&t===0&&s.row===this.lead.row&&s.column===this.lead.column,this.moveCursorTo(s.row,s.column+t,t===0);},e.prototype.moveCursorToPosition=function(e){this.moveCursorTo(e.row,e.column);},e.prototype.moveCursorTo=function(e,t,n){var r=this.session.getFoldAt(e,t,1);r&&(e=r.start.row,t=r.start.column),this.$keepDesiredColumnOnChange=!0;var i=this.session.getLine(e);/[\uDC00-\uDFFF]/.test(i.charAt(t))&&i.charAt(t-1)&&(this.lead.row==e&&this.lead.column==t+1?t-=1:t+=1),this.lead.setPosition(e,t),this.$keepDesiredColumnOnChange=!1,n||(this.$desiredColumn=null);},e.prototype.moveCursorToScreen=function(e,t,n){var r=this.session.screenToDocumentPosition(e,t);this.moveCursorTo(r.row,r.column,n);},e.prototype.detach=function(){this.lead.detach(),this.anchor.detach();},e.prototype.fromOrientedRange=function(e){this.setSelectionRange(e,e.cursor==e.start),this.$desiredColumn=e.desiredColumn||this.$desiredColumn;},e.prototype.toOrientedRange=function(e){var t=this.getRange();return e?(e.start.column=t.start.column,e.start.row=t.start.row,e.end.column=t.end.column,e.end.row=t.end.row):e=t,e.cursor=this.isBackwards()?e.start:e.end,e.desiredColumn=this.$desiredColumn,e},e.prototype.getRangeOfMovements=function(e){var t=this.getCursor();try{e(this);var n=this.getCursor();return o.fromPoints(t,n)}catch(r){return o.fromPoints(t,t)}finally{this.moveCursorToPosition(t);}},e.prototype.toJSON=function(){if(this.rangeCount)var e=this.ranges.map(function(e){var t=e.clone();return t.isBackwards=e.cursor==e.start,t});else {var e=this.getRange();e.isBackwards=this.isBackwards();}return e},e.prototype.fromJSON=function(e){if(e.start==undefined){if(this.rangeList&&e.length>1){this.toSingleRange(e[0]);for(var t=e.length;t--;){var n=o.fromPoints(e[t].start,e[t].end);e[t].isBackwards&&(n.cursor=n.start),this.addRange(n,!0);}return}e=e[0];}this.rangeList&&this.toSingleRange(e),this.setSelectionRange(e,e.isBackwards);},e.prototype.isEqual=function(e){if((e.length||this.rangeCount)&&e.length!=this.rangeCount)return !1;if(!e.length||!this.ranges)return this.getRange().isEqual(e);for(var t=this.ranges.length;t--;)if(!this.ranges[t].isEqual(e[t]))return !1;return !0},e}();u.prototype.setSelectionAnchor=u.prototype.setAnchor,u.prototype.getSelectionAnchor=u.prototype.getAnchor,u.prototype.setSelectionRange=u.prototype.setRange,r.implement(u.prototype,s),t.Selection=u;}),ace.define("ace/tokenizer",["require","exports","module","ace/lib/report_error"],function(e,t,n){var r=e("./lib/report_error").reportError,i=2e3,s=function(){function e(e){this.states=e,this.regExps={},this.matchMappings={};for(var t in this.states){var n=this.states[t],r=[],i=0,s=this.matchMappings[t]={defaultToken:"text"},o="g",u=[];for(var a=0;a<n.length;a++){var f=n[a];f.defaultToken&&(s.defaultToken=f.defaultToken),f.caseInsensitive&&o.indexOf("i")===-1&&(o+="i"),f.unicode&&o.indexOf("u")===-1&&(o+="u");if(f.regex==null)continue;f.regex instanceof RegExp&&(f.regex=f.regex.toString().slice(1,-1));var l=f.regex,c=(new RegExp("(?:("+l+")|(.))")).exec("a").length-2;Array.isArray(f.token)?f.token.length==1||c==1?f.token=f.token[0]:c-1!=f.token.length?(this.reportError("number of classes and regexp groups doesn't match",{rule:f,groupCount:c-1}),f.token=f.token[0]):(f.tokenArray=f.token,f.token=null,f.onMatch=this.$arrayTokens):typeof f.token=="function"&&!f.onMatch&&(c>1?f.onMatch=this.$applyToken:f.onMatch=f.token),c>1&&(/\\\d/.test(f.regex)?l=f.regex.replace(/\\([0-9]+)/g,function(e,t){return "\\"+(parseInt(t,10)+i+1)}):(c=1,l=this.removeCapturingGroups(f.regex)),!f.splitRegex&&typeof f.token!="string"&&u.push(f)),s[i]=a,i+=c,r.push(l),f.onMatch||(f.onMatch=null);}r.length||(s[0]=0,r.push("$")),u.forEach(function(e){e.splitRegex=this.createSplitterRegexp(e.regex,o);},this),this.regExps[t]=new RegExp("("+r.join(")|(")+")|($)",o);}}return e.prototype.$setMaxTokenCount=function(e){i=e|0;},e.prototype.$applyToken=function(e){var t=this.splitRegex.exec(e).slice(1),n=this.token.apply(this,t);if(typeof n=="string")return [{type:n,value:e}];var r=[];for(var i=0,s=n.length;i<s;i++)t[i]&&(r[r.length]={type:n[i],value:t[i]});return r},e.prototype.$arrayTokens=function(e){if(!e)return [];var t=this.splitRegex.exec(e);if(!t)return "text";var n=[],r=this.tokenArray;for(var i=0,s=r.length;i<s;i++)t[i+1]&&(n[n.length]={type:r[i],value:t[i+1]});return n},e.prototype.removeCapturingGroups=function(e){var t=e.replace(/\\.|\[(?:\\.|[^\\\]])*|\(\?[:=!<]|(\()/g,function(e,t){return t?"(?:":e});return t},e.prototype.createSplitterRegexp=function(e,t){if(e.indexOf("(?=")!=-1){var n=0,r=!1,i={};e.replace(/(\\.)|(\((?:\?[=!])?)|(\))|([\[\]])/g,function(e,t,s,o,u,a){return r?r=u!="]":u?r=!0:o?(n==i.stack&&(i.end=a+1,i.stack=-1),n--):s&&(n++,s.length!=1&&(i.stack=n,i.start=a)),e}),i.end!=null&&/^\)*$/.test(e.substr(i.end))&&(e=e.substring(0,i.start)+e.substr(i.end));}return e.charAt(0)!="^"&&(e="^"+e),e.charAt(e.length-1)!="$"&&(e+="$"),new RegExp(e,(t||"").replace("g",""))},e.prototype.getLineTokens=function(e,t){if(t&&typeof t!="string"){var n=t.slice(0);t=n[0],t==="#tmp"&&(n.shift(),t=n.shift());}else var n=[];var r=t||"start",s=this.states[r];s||(r="start",s=this.states[r]);var o=this.matchMappings[r],u=this.regExps[r];u.lastIndex=0;var a,f=[],l=0,c=0,h={type:null,value:""};while(a=u.exec(e)){var p=o.defaultToken,d=null,v=a[0],m=u.lastIndex;if(m-v.length>l){var g=e.substring(l,m-v.length);h.type==p?h.value+=g:(h.type&&f.push(h),h={type:p,value:g});}for(var y=0;y<a.length-2;y++){if(a[y+1]===undefined)continue;d=s[o[y]],d.onMatch?p=d.onMatch(v,r,n,e):p=d.token,d.next&&(typeof d.next=="string"?r=d.next:r=d.next(r,n),s=this.states[r],s||(this.reportError("state doesn't exist",r),r="start",s=this.states[r]),o=this.matchMappings[r],l=m,u=this.regExps[r],u.lastIndex=m),d.consumeLineEnd&&(l=m);break}if(v)if(typeof p=="string")!!d&&d.merge===!1||h.type!==p?(h.type&&f.push(h),h={type:p,value:v}):h.value+=v;else if(p){h.type&&f.push(h),h={type:null,value:""};for(var y=0;y<p.length;y++)f.push(p[y]);}if(l==e.length)break;l=m;if(c++>i){c>2*e.length&&this.reportError("infinite loop with in ace tokenizer",{startState:t,line:e});while(l<e.length)h.type&&f.push(h),h={value:e.substring(l,l+=500),type:"overflow"};r="start",n=[];break}}return h.type&&f.push(h),n.length>1&&n[0]!==r&&n.unshift("#tmp",r),{tokens:f,state:n.length?n:r}},e}();s.prototype.reportError=r,t.Tokenizer=s;}),ace.define("ace/mode/text_highlight_rules",["require","exports","module","ace/lib/deep_copy"],function(e,t,n){var r=e("../lib/deep_copy").deepCopy,i=function(){this.$rules={start:[{token:"empty_line",regex:"^$"},{defaultToken:"text"}]};};((function(){this.addRules=function(e,t){if(!t){for(var n in e)this.$rules[n]=e[n];return}for(var n in e){var r=e[n];for(var i=0;i<r.length;i++){var s=r[i];if(s.next||s.onMatch)typeof s.next=="string"&&s.next.indexOf(t)!==0&&(s.next=t+s.next),s.nextState&&s.nextState.indexOf(t)!==0&&(s.nextState=t+s.nextState);}this.$rules[t+n]=r;}},this.getRules=function(){return this.$rules},this.embedRules=function(e,t,n,i,s){var o=typeof e=="function"?(new e).getRules():e;if(i)for(var u=0;u<i.length;u++)i[u]=t+i[u];else {i=[];for(var a in o)i.push(t+a);}this.addRules(o,t);if(n){var f=Array.prototype[s?"push":"unshift"];for(var u=0;u<i.length;u++)f.apply(this.$rules[i[u]],r(n));}this.$embeds||(this.$embeds=[]),this.$embeds.push(t);},this.getEmbeds=function(){return this.$embeds};var e=function(e,t){return (e!="start"||t.length)&&t.unshift(this.nextState,e),this.nextState},t=function(e,t){return t.shift(),t.shift()||"start"};this.normalizeRules=function(){function i(s){var o=r[s];o.processed=!0;for(var u=0;u<o.length;u++){var a=o[u],f=null;Array.isArray(a)&&(f=a,a={}),!a.regex&&a.start&&(a.regex=a.start,a.next||(a.next=[]),a.next.push({defaultToken:a.token},{token:a.token+".end",regex:a.end||a.start,next:"pop"}),a.token=a.token+".start",a.push=!0);var l=a.next||a.push;if(l&&Array.isArray(l)){var c=a.stateName;c||(c=a.token,typeof c!="string"&&(c=c[0]||""),r[c]&&(c+=n++)),r[c]=l,a.next=c,i(c);}else l=="pop"&&(a.next=t);a.push&&(a.nextState=a.next||a.push,a.next=e,delete a.push);if(a.rules)for(var h in a.rules)r[h]?r[h].push&&r[h].push.apply(r[h],a.rules[h]):r[h]=a.rules[h];var p=typeof a=="string"?a:a.include;p&&(p==="$self"&&(p="start"),Array.isArray(p)?f=p.map(function(e){return r[e]}):f=r[p]);if(f){var d=[u,1].concat(f);a.noEscape&&(d=d.filter(function(e){return !e.next})),o.splice.apply(o,d),u--;}a.keywordMap&&(a.token=this.createKeywordMapper(a.keywordMap,a.defaultToken||"text",a.caseInsensitive),delete a.defaultToken);}}var n=0,r=this.$rules;Object.keys(r).forEach(i,this);},this.createKeywordMapper=function(e,t,n,r){var i=Object.create(null);return this.$keywordList=[],Object.keys(e).forEach(function(t){var s=e[t],o=s.split(r||"|");for(var u=o.length;u--;){var a=o[u];this.$keywordList.push(a),n&&(a=a.toLowerCase()),i[a]=t;}},this),e=null,n?function(e){return i[e.toLowerCase()]||t}:function(e){return i[e]||t}},this.getKeywords=function(){return this.$keywords};})).call(i.prototype),t.TextHighlightRules=i;}),ace.define("ace/mode/behaviour",["require","exports","module"],function(e,t,n){var r=function(){this.$behaviours={};};((function(){this.add=function(e,t,n){switch(undefined){case this.$behaviours:this.$behaviours={};case this.$behaviours[e]:this.$behaviours[e]={};}this.$behaviours[e][t]=n;},this.addBehaviours=function(e){for(var t in e)for(var n in e[t])this.add(t,n,e[t][n]);},this.remove=function(e){this.$behaviours&&this.$behaviours[e]&&delete this.$behaviours[e];},this.inherit=function(e,t){if(typeof e=="function")var n=(new e).getBehaviours(t);else var n=e.getBehaviours(t);this.addBehaviours(n);},this.getBehaviours=function(e){if(!e)return this.$behaviours;var t={};for(var n=0;n<e.length;n++)this.$behaviours[e[n]]&&(t[e[n]]=this.$behaviours[e[n]]);return t};})).call(r.prototype),t.Behaviour=r;}),ace.define("ace/token_iterator",["require","exports","module","ace/range"],function(e,t,n){var r=e("./range").Range,i=function(){function e(e,t,n){this.$session=e,this.$row=t,this.$rowTokens=e.getTokens(t);var r=e.getTokenAt(t,n);this.$tokenIndex=r?r.index:-1;}return e.prototype.stepBackward=function(){this.$tokenIndex-=1;while(this.$tokenIndex<0){this.$row-=1;if(this.$row<0)return this.$row=0,null;this.$rowTokens=this.$session.getTokens(this.$row),this.$tokenIndex=this.$rowTokens.length-1;}return this.$rowTokens[this.$tokenIndex]},e.prototype.stepForward=function(){this.$tokenIndex+=1;var e;while(this.$tokenIndex>=this.$rowTokens.length){this.$row+=1,e||(e=this.$session.getLength());if(this.$row>=e)return this.$row=e-1,null;this.$rowTokens=this.$session.getTokens(this.$row),this.$tokenIndex=0;}return this.$rowTokens[this.$tokenIndex]},e.prototype.getCurrentToken=function(){return this.$rowTokens[this.$tokenIndex]},e.prototype.getCurrentTokenRow=function(){return this.$row},e.prototype.getCurrentTokenColumn=function(){var e=this.$rowTokens,t=this.$tokenIndex,n=e[t].start;if(n!==undefined)return n;n=0;while(t>0)t-=1,n+=e[t].value.length;return n},e.prototype.getCurrentTokenPosition=function(){return {row:this.$row,column:this.getCurrentTokenColumn()}},e.prototype.getCurrentTokenRange=function(){var e=this.$rowTokens[this.$tokenIndex],t=this.getCurrentTokenColumn();return new r(this.$row,t,this.$row,t+e.value.length)},e}();t.TokenIterator=i;}),ace.define("ace/mode/behaviour/cstyle",["require","exports","module","ace/lib/oop","ace/mode/behaviour","ace/token_iterator","ace/lib/lang"],function(e,t,n){var r=e("../../lib/oop"),i=e("../behaviour").Behaviour,s=e("../../token_iterator").TokenIterator,o=e("../../lib/lang"),u=["text","paren.rparen","rparen","paren","punctuation.operator"],a=["text","paren.rparen","rparen","paren","punctuation.operator","comment"],f,l={},c={'"':'"',"'":"'"},h=function(e){var t=-1;e.multiSelect&&(t=e.selection.index,l.rangeCount!=e.multiSelect.rangeCount&&(l={rangeCount:e.multiSelect.rangeCount}));if(l[t])return f=l[t];f=l[t]={autoInsertedBrackets:0,autoInsertedRow:-1,autoInsertedLineEnd:"",maybeInsertedBrackets:0,maybeInsertedRow:-1,maybeInsertedLineStart:"",maybeInsertedLineEnd:""};},p=function(e,t,n,r){var i=e.end.row-e.start.row;return {text:n+t+r,selection:[0,e.start.column+1,i,e.end.column+(i?0:1)]}},d=function(e){e=e||{},this.add("braces","insertion",function(t,n,r,i,s){var u=r.getCursorPosition(),a=i.doc.getLine(u.row);if(s=="{"){h(r);var l=r.getSelectionRange(),c=i.doc.getTextRange(l);if(c!==""&&c!=="{"&&r.getWrapBehavioursEnabled())return p(l,c,"{","}");if(d.isSaneInsertion(r,i))return /[\]\}\)]/.test(a[u.column])||r.inMultiSelectMode||e.braces?(d.recordAutoInsert(r,i,"}"),{text:"{}",selection:[1,1]}):(d.recordMaybeInsert(r,i,"{"),{text:"{",selection:[1,1]})}else if(s=="}"){h(r);var v=a.substring(u.column,u.column+1);if(v=="}"){var m=i.$findOpeningBracket("}",{column:u.column+1,row:u.row});if(m!==null&&d.isAutoInsertedClosing(u,a,s))return d.popAutoInsertedClosing(),{text:"",selection:[1,1]}}}else {if(s=="\n"||s=="\r\n"){h(r);var g="";d.isMaybeInsertedClosing(u,a)&&(g=o.stringRepeat("}",f.maybeInsertedBrackets),d.clearMaybeInsertedClosing());var v=a.substring(u.column,u.column+1);if(v==="}"){var y=i.findMatchingBracket({row:u.row,column:u.column+1},"}");if(!y)return null;var b=this.$getIndent(i.getLine(y.row));}else {if(!g){d.clearMaybeInsertedClosing();return}var b=this.$getIndent(a);}var w=b+i.getTabString();return {text:"\n"+w+"\n"+b+g,selection:[1,w.length,1,w.length]}}d.clearMaybeInsertedClosing();}}),this.add("braces","deletion",function(e,t,n,r,i){var s=r.doc.getTextRange(i);if(!i.isMultiLine()&&s=="{"){h(n);var o=r.doc.getLine(i.start.row),u=o.substring(i.end.column,i.end.column+1);if(u=="}")return i.end.column++,i;f.maybeInsertedBrackets--;}}),this.add("parens","insertion",function(e,t,n,r,i){if(i=="("){h(n);var s=n.getSelectionRange(),o=r.doc.getTextRange(s);if(o!==""&&n.getWrapBehavioursEnabled())return p(s,o,"(",")");if(d.isSaneInsertion(n,r))return d.recordAutoInsert(n,r,")"),{text:"()",selection:[1,1]}}else if(i==")"){h(n);var u=n.getCursorPosition(),a=r.doc.getLine(u.row),f=a.substring(u.column,u.column+1);if(f==")"){var l=r.$findOpeningBracket(")",{column:u.column+1,row:u.row});if(l!==null&&d.isAutoInsertedClosing(u,a,i))return d.popAutoInsertedClosing(),{text:"",selection:[1,1]}}}}),this.add("parens","deletion",function(e,t,n,r,i){var s=r.doc.getTextRange(i);if(!i.isMultiLine()&&s=="("){h(n);var o=r.doc.getLine(i.start.row),u=o.substring(i.start.column+1,i.start.column+2);if(u==")")return i.end.column++,i}}),this.add("brackets","insertion",function(e,t,n,r,i){if(i=="["){h(n);var s=n.getSelectionRange(),o=r.doc.getTextRange(s);if(o!==""&&n.getWrapBehavioursEnabled())return p(s,o,"[","]");if(d.isSaneInsertion(n,r))return d.recordAutoInsert(n,r,"]"),{text:"[]",selection:[1,1]}}else if(i=="]"){h(n);var u=n.getCursorPosition(),a=r.doc.getLine(u.row),f=a.substring(u.column,u.column+1);if(f=="]"){var l=r.$findOpeningBracket("]",{column:u.column+1,row:u.row});if(l!==null&&d.isAutoInsertedClosing(u,a,i))return d.popAutoInsertedClosing(),{text:"",selection:[1,1]}}}}),this.add("brackets","deletion",function(e,t,n,r,i){var s=r.doc.getTextRange(i);if(!i.isMultiLine()&&s=="["){h(n);var o=r.doc.getLine(i.start.row),u=o.substring(i.start.column+1,i.start.column+2);if(u=="]")return i.end.column++,i}}),this.add("string_dquotes","insertion",function(e,t,n,r,i){var s=r.$mode.$quotes||c;if(i.length==1&&s[i]){if(this.lineCommentStart&&this.lineCommentStart.indexOf(i)!=-1)return;h(n);var o=i,u=n.getSelectionRange(),a=r.doc.getTextRange(u);if(a!==""&&(a.length!=1||!s[a])&&n.getWrapBehavioursEnabled())return p(u,a,o,o);if(!a){var f=n.getCursorPosition(),l=r.doc.getLine(f.row),d=l.substring(f.column-1,f.column),v=l.substring(f.column,f.column+1),m=r.getTokenAt(f.row,f.column),g=r.getTokenAt(f.row,f.column+1);if(d=="\\"&&m&&/escape/.test(m.type))return null;var y=m&&/string|escape/.test(m.type),b=!g||/string|escape/.test(g.type),w;if(v==o)w=y!==b,w&&/string\.end/.test(g.type)&&(w=!1);else {if(y&&!b)return null;if(y&&b)return null;var E=r.$mode.tokenRe;E.lastIndex=0;var S=E.test(d);E.lastIndex=0;var x=E.test(v),T=r.$mode.$pairQuotesAfter,N=T&&T[o]&&T[o].test(d);if(!N&&S||x)return null;if(v&&!/[\s;,.})\]\\]/.test(v))return null;var C=l[f.column-2];if(!(d!=o||C!=o&&!E.test(C)))return null;w=!0;}return {text:w?o+o:"",selection:[1,1]}}}}),this.add("string_dquotes","deletion",function(e,t,n,r,i){var s=r.$mode.$quotes||c,o=r.doc.getTextRange(i);if(!i.isMultiLine()&&s.hasOwnProperty(o)){h(n);var u=r.doc.getLine(i.start.row),a=u.substring(i.start.column+1,i.start.column+2);if(a==o)return i.end.column++,i}}),e.closeDocComment!==!1&&this.add("doc comment end","insertion",function(e,t,n,r,i){if(e==="doc-start"&&(i==="\n"||i==="\r\n")&&n.selection.isEmpty()){var s=n.getCursorPosition(),o=r.doc.getLine(s.row),u=r.doc.getLine(s.row+1),a=this.$getIndent(o);if(/\s*\*/.test(u))return /^\s*\*/.test(o)?{text:i+a+"* ",selection:[1,3+a.length,1,3+a.length]}:{text:i+a+" * ",selection:[1,3+a.length,1,3+a.length]};if(/\/\*\*/.test(o.substring(0,s.column)))return {text:i+a+" * "+i+" "+a+"*/",selection:[1,4+a.length,1,4+a.length]}}});};d.isSaneInsertion=function(e,t){var n=e.getCursorPosition(),r=new s(t,n.row,n.column);if(!this.$matchTokenType(r.getCurrentToken()||"text",u)){if(/[)}\]]/.test(e.session.getLine(n.row)[n.column]))return !0;var i=new s(t,n.row,n.column+1);if(!this.$matchTokenType(i.getCurrentToken()||"text",u))return !1}return r.stepForward(),r.getCurrentTokenRow()!==n.row||this.$matchTokenType(r.getCurrentToken()||"text",a)},d.$matchTokenType=function(e,t){return t.indexOf(e.type||e)>-1},d.recordAutoInsert=function(e,t,n){var r=e.getCursorPosition(),i=t.doc.getLine(r.row);this.isAutoInsertedClosing(r,i,f.autoInsertedLineEnd[0])||(f.autoInsertedBrackets=0),f.autoInsertedRow=r.row,f.autoInsertedLineEnd=n+i.substr(r.column),f.autoInsertedBrackets++;},d.recordMaybeInsert=function(e,t,n){var r=e.getCursorPosition(),i=t.doc.getLine(r.row);this.isMaybeInsertedClosing(r,i)||(f.maybeInsertedBrackets=0),f.maybeInsertedRow=r.row,f.maybeInsertedLineStart=i.substr(0,r.column)+n,f.maybeInsertedLineEnd=i.substr(r.column),f.maybeInsertedBrackets++;},d.isAutoInsertedClosing=function(e,t,n){return f.autoInsertedBrackets>0&&e.row===f.autoInsertedRow&&n===f.autoInsertedLineEnd[0]&&t.substr(e.column)===f.autoInsertedLineEnd},d.isMaybeInsertedClosing=function(e,t){return f.maybeInsertedBrackets>0&&e.row===f.maybeInsertedRow&&t.substr(e.column)===f.maybeInsertedLineEnd&&t.substr(0,e.column)==f.maybeInsertedLineStart},d.popAutoInsertedClosing=function(){f.autoInsertedLineEnd=f.autoInsertedLineEnd.substr(1),f.autoInsertedBrackets--;},d.clearMaybeInsertedClosing=function(){f&&(f.maybeInsertedBrackets=0,f.maybeInsertedRow=-1);},r.inherits(d,i),t.CstyleBehaviour=d;}),ace.define("ace/unicode",["require","exports","module"],function(e,t,n){var r=[48,9,8,25,5,0,2,25,48,0,11,0,5,0,6,22,2,30,2,457,5,11,15,4,8,0,2,0,18,116,2,1,3,3,9,0,2,2,2,0,2,19,2,82,2,138,2,4,3,155,12,37,3,0,8,38,10,44,2,0,2,1,2,1,2,0,9,26,6,2,30,10,7,61,2,9,5,101,2,7,3,9,2,18,3,0,17,58,3,100,15,53,5,0,6,45,211,57,3,18,2,5,3,11,3,9,2,1,7,6,2,2,2,7,3,1,3,21,2,6,2,0,4,3,3,8,3,1,3,3,9,0,5,1,2,4,3,11,16,2,2,5,5,1,3,21,2,6,2,1,2,1,2,1,3,0,2,4,5,1,3,2,4,0,8,3,2,0,8,15,12,2,2,8,2,2,2,21,2,6,2,1,2,4,3,9,2,2,2,2,3,0,16,3,3,9,18,2,2,7,3,1,3,21,2,6,2,1,2,4,3,8,3,1,3,2,9,1,5,1,2,4,3,9,2,0,17,1,2,5,4,2,2,3,4,1,2,0,2,1,4,1,4,2,4,11,5,4,4,2,2,3,3,0,7,0,15,9,18,2,2,7,2,2,2,22,2,9,2,4,4,7,2,2,2,3,8,1,2,1,7,3,3,9,19,1,2,7,2,2,2,22,2,9,2,4,3,8,2,2,2,3,8,1,8,0,2,3,3,9,19,1,2,7,2,2,2,22,2,15,4,7,2,2,2,3,10,0,9,3,3,9,11,5,3,1,2,17,4,23,2,8,2,0,3,6,4,0,5,5,2,0,2,7,19,1,14,57,6,14,2,9,40,1,2,0,3,1,2,0,3,0,7,3,2,6,2,2,2,0,2,0,3,1,2,12,2,2,3,4,2,0,2,5,3,9,3,1,35,0,24,1,7,9,12,0,2,0,2,0,5,9,2,35,5,19,2,5,5,7,2,35,10,0,58,73,7,77,3,37,11,42,2,0,4,328,2,3,3,6,2,0,2,3,3,40,2,3,3,32,2,3,3,6,2,0,2,3,3,14,2,56,2,3,3,66,5,0,33,15,17,84,13,619,3,16,2,25,6,74,22,12,2,6,12,20,12,19,13,12,2,2,2,1,13,51,3,29,4,0,5,1,3,9,34,2,3,9,7,87,9,42,6,69,11,28,4,11,5,11,11,39,3,4,12,43,5,25,7,10,38,27,5,62,2,28,3,10,7,9,14,0,89,75,5,9,18,8,13,42,4,11,71,55,9,9,4,48,83,2,2,30,14,230,23,280,3,5,3,37,3,5,3,7,2,0,2,0,2,0,2,30,3,52,2,6,2,0,4,2,2,6,4,3,3,5,5,12,6,2,2,6,67,1,20,0,29,0,14,0,17,4,60,12,5,0,4,11,18,0,5,0,3,9,2,0,4,4,7,0,2,0,2,0,2,3,2,10,3,3,6,4,5,0,53,1,2684,46,2,46,2,132,7,6,15,37,11,53,10,0,17,22,10,6,2,6,2,6,2,6,2,6,2,6,2,6,2,6,2,31,48,0,470,1,36,5,2,4,6,1,5,85,3,1,3,2,2,89,2,3,6,40,4,93,18,23,57,15,513,6581,75,20939,53,1164,68,45,3,268,4,27,21,31,3,13,13,1,2,24,9,69,11,1,38,8,3,102,3,1,111,44,25,51,13,68,12,9,7,23,4,0,5,45,3,35,13,28,4,64,15,10,39,54,10,13,3,9,7,22,4,1,5,66,25,2,227,42,2,1,3,9,7,11171,13,22,5,48,8453,301,3,61,3,105,39,6,13,4,6,11,2,12,2,4,2,0,2,1,2,1,2,107,34,362,19,63,3,53,41,11,5,15,17,6,13,1,25,2,33,4,2,134,20,9,8,25,5,0,2,25,12,88,4,5,3,5,3,5,3,2],i=0,s=[];for(var o=0;o<r.length;o+=2)s.push(i+=r[o]),r[o+1]&&s.push(45,i+=r[o+1]);t.wordChars=String.fromCharCode.apply(null,s);}),ace.define("ace/mode/text",["require","exports","module","ace/config","ace/tokenizer","ace/mode/text_highlight_rules","ace/mode/behaviour/cstyle","ace/unicode","ace/lib/lang","ace/token_iterator","ace/range"],function(e,t,n){var r=e("../config"),i=e("../tokenizer").Tokenizer,s=e("./text_highlight_rules").TextHighlightRules,o=e("./behaviour/cstyle").CstyleBehaviour,u=e("../unicode"),a=e("../lib/lang"),f=e("../token_iterator").TokenIterator,l=e("../range").Range,c=function(){this.HighlightRules=s;};((function(){this.$defaultBehaviour=new o,this.tokenRe=new RegExp("^["+u.wordChars+"\\$_]+","g"),this.nonTokenRe=new RegExp("^(?:[^"+u.wordChars+"\\$_]|\\s])+","g"),this.getTokenizer=function(){return this.$tokenizer||(this.$highlightRules=this.$highlightRules||new this.HighlightRules(this.$highlightRuleConfig),this.$tokenizer=new i(this.$highlightRules.getRules())),this.$tokenizer},this.lineCommentStart="",this.blockComment="",this.toggleCommentLines=function(e,t,n,r){function w(e){for(var t=n;t<=r;t++)e(i.getLine(t),t);}var i=t.doc,s=!0,o=!0,u=Infinity,f=t.getTabSize(),l=!1;if(!this.lineCommentStart){if(!this.blockComment)return !1;var c=this.blockComment.start,h=this.blockComment.end,p=new RegExp("^(\\s*)(?:"+a.escapeRegExp(c)+")"),d=new RegExp("(?:"+a.escapeRegExp(h)+")\\s*$"),v=function(e,t){if(g(e,t))return;if(!s||/\S/.test(e))i.insertInLine({row:t,column:e.length},h),i.insertInLine({row:t,column:u},c);},m=function(e,t){var n;(n=e.match(d))&&i.removeInLine(t,e.length-n[0].length,e.length),(n=e.match(p))&&i.removeInLine(t,n[1].length,n[0].length);},g=function(e,n){if(p.test(e))return !0;var r=t.getTokens(n);for(var i=0;i<r.length;i++)if(r[i].type==="comment")return !0};}else {if(Array.isArray(this.lineCommentStart))var p=this.lineCommentStart.map(a.escapeRegExp).join("|"),c=this.lineCommentStart[0];else var p=a.escapeRegExp(this.lineCommentStart),c=this.lineCommentStart;p=new RegExp("^(\\s*)(?:"+p+") ?"),l=t.getUseSoftTabs();var m=function(e,t){var n=e.match(p);if(!n)return;var r=n[1].length,s=n[0].length;!b(e,r,s)&&n[0][s-1]==" "&&s--,i.removeInLine(t,r,s);},y=c+" ",v=function(e,t){if(!s||/\S/.test(e))b(e,u,u)?i.insertInLine({row:t,column:u},y):i.insertInLine({row:t,column:u},c);},g=function(e,t){return p.test(e)},b=function(e,t,n){var r=0;while(t--&&e.charAt(t)==" ")r++;if(r%f!=0)return !1;var r=0;while(e.charAt(n++)==" ")r++;return f>2?r%f!=f-1:r%f==0};}var E=Infinity;w(function(e,t){var n=e.search(/\S/);n!==-1?(n<u&&(u=n),o&&!g(e,t)&&(o=!1)):E>e.length&&(E=e.length);}),u==Infinity&&(u=E,s=!1,o=!1),l&&u%f!=0&&(u=Math.floor(u/f)*f),w(o?m:v);},this.toggleBlockComment=function(e,t,n,r){var i=this.blockComment;if(!i)return;!i.start&&i[0]&&(i=i[0]);var s=new f(t,r.row,r.column),o=s.getCurrentToken();t.selection;var a=t.selection.toOrientedRange(),c,h;if(o&&/comment/.test(o.type)){var p,d;while(o&&/comment/.test(o.type)){var v=o.value.indexOf(i.start);if(v!=-1){var m=s.getCurrentTokenRow(),g=s.getCurrentTokenColumn()+v;p=new l(m,g,m,g+i.start.length);break}o=s.stepBackward();}var s=new f(t,r.row,r.column),o=s.getCurrentToken();while(o&&/comment/.test(o.type)){var v=o.value.indexOf(i.end);if(v!=-1){var m=s.getCurrentTokenRow(),g=s.getCurrentTokenColumn()+v;d=new l(m,g,m,g+i.end.length);break}o=s.stepForward();}d&&t.remove(d),p&&(t.remove(p),c=p.start.row,h=-i.start.length);}else h=i.start.length,c=n.start.row,t.insert(n.end,i.end),t.insert(n.start,i.start);a.start.row==c&&(a.start.column+=h),a.end.row==c&&(a.end.column+=h),t.selection.fromOrientedRange(a);},this.getNextLineIndent=function(e,t,n){return this.$getIndent(t)},this.checkOutdent=function(e,t,n){return !1},this.autoOutdent=function(e,t,n){},this.$getIndent=function(e){return e.match(/^\s*/)[0]},this.createWorker=function(e){return null},this.createModeDelegates=function(e){this.$embeds=[],this.$modes={};for(var t in e)if(e[t]){var n=e[t],i=n.prototype.$id,s=r.$modes[i];s||(r.$modes[i]=s=new n),r.$modes[t]||(r.$modes[t]=s),this.$embeds.push(t),this.$modes[t]=s;}var o=["toggleBlockComment","toggleCommentLines","getNextLineIndent","checkOutdent","autoOutdent","transformAction","getCompletions"];for(var t=0;t<o.length;t++)(function(e){var n=o[t],r=e[n];e[o[t]]=function(){return this.$delegator(n,arguments,r)};})(this);},this.$delegator=function(e,t,n){var r=t[0]||"start";if(typeof r!="string"){if(Array.isArray(r[2])){var i=r[2][r[2].length-1],s=this.$modes[i];if(s)return s[e].apply(s,[r[1]].concat([].slice.call(t,1)))}r=r[0]||"start";}for(var o=0;o<this.$embeds.length;o++){if(!this.$modes[this.$embeds[o]])continue;var u=r.split(this.$embeds[o]);if(!u[0]&&u[1]){t[0]=u[1];var s=this.$modes[this.$embeds[o]];return s[e].apply(s,t)}}var a=n.apply(this,t);return n?a:undefined},this.transformAction=function(e,t,n,r,i){if(this.$behaviour){var s=this.$behaviour.getBehaviours();for(var o in s)if(s[o][t]){var u=s[o][t].apply(this,arguments);if(u)return u}}},this.getKeywords=function(e){if(!this.completionKeywords){var t=this.$tokenizer.rules,n=[];for(var r in t){var i=t[r];for(var s=0,o=i.length;s<o;s++)if(typeof i[s].token=="string")/keyword|support|storage/.test(i[s].token)&&n.push(i[s].regex);else if(typeof i[s].token=="object")for(var u=0,a=i[s].token.length;u<a;u++)if(/keyword|support|storage/.test(i[s].token[u])){var r=i[s].regex.match(/\(.+?\)/g)[u];n.push(r.substr(1,r.length-2));}}this.completionKeywords=n;}return e?n.concat(this.$keywordList||[]):this.$keywordList},this.$createKeywordList=function(){return this.$highlightRules||this.getTokenizer(),this.$keywordList=this.$highlightRules.$keywordList||[]},this.getCompletions=function(e,t,n,r){var i=this.$keywordList||this.$createKeywordList();return i.map(function(e){return {name:e,value:e,score:0,meta:"keyword"}})},this.$id="ace/mode/text";})).call(c.prototype),t.Mode=c;}),ace.define("ace/apply_delta",["require","exports","module"],function(e,t,n){t.applyDelta=function(e,t,n){var r=t.start.row,i=t.start.column,s=e[r]||"";switch(t.action){case"insert":var o=t.lines;if(o.length===1)e[r]=s.substring(0,i)+t.lines[0]+s.substring(i);else {var u=[r,1].concat(t.lines);e.splice.apply(e,u),e[r]=s.substring(0,i)+e[r],e[r+t.lines.length-1]+=s.substring(i);}break;case"remove":var a=t.end.column,f=t.end.row;r===f?e[r]=s.substring(0,i)+s.substring(a):e.splice(r,f-r+1,s.substring(0,i)+e[f].substring(a));}};}),ace.define("ace/anchor",["require","exports","module","ace/lib/oop","ace/lib/event_emitter"],function(e,t,n){function o(e,t,n){var r=n?e.column<=t.column:e.column<t.column;return e.row<t.row||e.row==t.row&&r}function u(e,t,n){var r=e.action=="insert",i=(r?1:-1)*(e.end.row-e.start.row),s=(r?1:-1)*(e.end.column-e.start.column),u=e.start,a=r?u:e.end;return o(t,u,n)?{row:t.row,column:t.column}:o(a,t,!n)?{row:t.row+i,column:t.column+(t.row==a.row?s:0)}:{row:u.row,column:u.column}}var r=e("./lib/oop"),i=e("./lib/event_emitter").EventEmitter,s=function(){function e(e,t,n){this.$onChange=this.onChange.bind(this),this.attach(e),typeof n=="undefined"?this.setPosition(t.row,t.column):this.setPosition(t,n);}return e.prototype.getPosition=function(){return this.$clipPositionToDocument(this.row,this.column)},e.prototype.getDocument=function(){return this.document},e.prototype.onChange=function(e){if(e.start.row==e.end.row&&e.start.row!=this.row)return;if(e.start.row>this.row)return;var t=u(e,{row:this.row,column:this.column},this.$insertRight);this.setPosition(t.row,t.column,!0);},e.prototype.setPosition=function(e,t,n){var r;n?r={row:e,column:t}:r=this.$clipPositionToDocument(e,t);if(this.row==r.row&&this.column==r.column)return;var i={row:this.row,column:this.column};this.row=r.row,this.column=r.column,this._signal("change",{old:i,value:r});},e.prototype.detach=function(){this.document.off("change",this.$onChange);},e.prototype.attach=function(e){this.document=e||this.document,this.document.on("change",this.$onChange);},e.prototype.$clipPositionToDocument=function(e,t){var n={};return e>=this.document.getLength()?(n.row=Math.max(0,this.document.getLength()-1),n.column=this.document.getLine(n.row).length):e<0?(n.row=0,n.column=0):(n.row=e,n.column=Math.min(this.document.getLine(n.row).length,Math.max(0,t))),t<0&&(n.column=0),n},e}();s.prototype.$insertRight=!1,r.implement(s.prototype,i),t.Anchor=s;}),ace.define("ace/document",["require","exports","module","ace/lib/oop","ace/apply_delta","ace/lib/event_emitter","ace/range","ace/anchor"],function(e,t,n){var r=e("./lib/oop"),i=e("./apply_delta").applyDelta,s=e("./lib/event_emitter").EventEmitter,o=e("./range").Range,u=e("./anchor").Anchor,a=function(){function e(e){this.$lines=[""],e.length===0?this.$lines=[""]:Array.isArray(e)?this.insertMergedLines({row:0,column:0},e):this.insert({row:0,column:0},e);}return e.prototype.setValue=function(e){var t=this.getLength()-1;this.remove(new o(0,0,t,this.getLine(t).length)),this.insert({row:0,column:0},e||"");},e.prototype.getValue=function(){return this.getAllLines().join(this.getNewLineCharacter())},e.prototype.createAnchor=function(e,t){return new u(this,e,t)},e.prototype.$detectNewLine=function(e){var t=e.match(/^.*?(\r\n|\r|\n)/m);this.$autoNewLine=t?t[1]:"\n",this._signal("changeNewLineMode");},e.prototype.getNewLineCharacter=function(){switch(this.$newLineMode){case"windows":return "\r\n";case"unix":return "\n";default:return this.$autoNewLine||"\n"}},e.prototype.setNewLineMode=function(e){if(this.$newLineMode===e)return;this.$newLineMode=e,this._signal("changeNewLineMode");},e.prototype.getNewLineMode=function(){return this.$newLineMode},e.prototype.isNewLine=function(e){return e=="\r\n"||e=="\r"||e=="\n"},e.prototype.getLine=function(e){return this.$lines[e]||""},e.prototype.getLines=function(e,t){return this.$lines.slice(e,t+1)},e.prototype.getAllLines=function(){return this.getLines(0,this.getLength())},e.prototype.getLength=function(){return this.$lines.length},e.prototype.getTextRange=function(e){return this.getLinesForRange(e).join(this.getNewLineCharacter())},e.prototype.getLinesForRange=function(e){var t;if(e.start.row===e.end.row)t=[this.getLine(e.start.row).substring(e.start.column,e.end.column)];else {t=this.getLines(e.start.row,e.end.row),t[0]=(t[0]||"").substring(e.start.column);var n=t.length-1;e.end.row-e.start.row==n&&(t[n]=t[n].substring(0,e.end.column));}return t},e.prototype.insertLines=function(e,t){return console.warn("Use of document.insertLines is deprecated. Use the insertFullLines method instead."),this.insertFullLines(e,t)},e.prototype.removeLines=function(e,t){return console.warn("Use of document.removeLines is deprecated. Use the removeFullLines method instead."),this.removeFullLines(e,t)},e.prototype.insertNewLine=function(e){return console.warn("Use of document.insertNewLine is deprecated. Use insertMergedLines(position, ['', '']) instead."),this.insertMergedLines(e,["",""])},e.prototype.insert=function(e,t){return this.getLength()<=1&&this.$detectNewLine(t),this.insertMergedLines(e,this.$split(t))},e.prototype.insertInLine=function(e,t){var n=this.clippedPos(e.row,e.column),r=this.pos(e.row,e.column+t.length);return this.applyDelta({start:n,end:r,action:"insert",lines:[t]},!0),this.clonePos(r)},e.prototype.clippedPos=function(e,t){var n=this.getLength();e===undefined?e=n:e<0?e=0:e>=n&&(e=n-1,t=undefined);var r=this.getLine(e);return t==undefined&&(t=r.length),t=Math.min(Math.max(t,0),r.length),{row:e,column:t}},e.prototype.clonePos=function(e){return {row:e.row,column:e.column}},e.prototype.pos=function(e,t){return {row:e,column:t}},e.prototype.$clipPosition=function(e){var t=this.getLength();return e.row>=t?(e.row=Math.max(0,t-1),e.column=this.getLine(t-1).length):(e.row=Math.max(0,e.row),e.column=Math.min(Math.max(e.column,0),this.getLine(e.row).length)),e},e.prototype.insertFullLines=function(e,t){e=Math.min(Math.max(e,0),this.getLength());var n=0;e<this.getLength()?(t=t.concat([""]),n=0):(t=[""].concat(t),e--,n=this.$lines[e].length),this.insertMergedLines({row:e,column:n},t);},e.prototype.insertMergedLines=function(e,t){var n=this.clippedPos(e.row,e.column),r={row:n.row+t.length-1,column:(t.length==1?n.column:0)+t[t.length-1].length};return this.applyDelta({start:n,end:r,action:"insert",lines:t}),this.clonePos(r)},e.prototype.remove=function(e){var t=this.clippedPos(e.start.row,e.start.column),n=this.clippedPos(e.end.row,e.end.column);return this.applyDelta({start:t,end:n,action:"remove",lines:this.getLinesForRange({start:t,end:n})}),this.clonePos(t)},e.prototype.removeInLine=function(e,t,n){var r=this.clippedPos(e,t),i=this.clippedPos(e,n);return this.applyDelta({start:r,end:i,action:"remove",lines:this.getLinesForRange({start:r,end:i})},!0),this.clonePos(r)},e.prototype.removeFullLines=function(e,t){e=Math.min(Math.max(0,e),this.getLength()-1),t=Math.min(Math.max(0,t),this.getLength()-1);var n=t==this.getLength()-1&&e>0,r=t<this.getLength()-1,i=n?e-1:e,s=n?this.getLine(i).length:0,u=r?t+1:t,a=r?0:this.getLine(u).length,f=new o(i,s,u,a),l=this.$lines.slice(e,t+1);return this.applyDelta({start:f.start,end:f.end,action:"remove",lines:this.getLinesForRange(f)}),l},e.prototype.removeNewLine=function(e){e<this.getLength()-1&&e>=0&&this.applyDelta({start:this.pos(e,this.getLine(e).length),end:this.pos(e+1,0),action:"remove",lines:["",""]});},e.prototype.replace=function(e,t){e instanceof o||(e=o.fromPoints(e.start,e.end));if(t.length===0&&e.isEmpty())return e.start;if(t==this.getTextRange(e))return e.end;this.remove(e);var n;return t?n=this.insert(e.start,t):n=e.start,n},e.prototype.applyDeltas=function(e){for(var t=0;t<e.length;t++)this.applyDelta(e[t]);},e.prototype.revertDeltas=function(e){for(var t=e.length-1;t>=0;t--)this.revertDelta(e[t]);},e.prototype.applyDelta=function(e,t){var n=e.action=="insert";if(n?e.lines.length<=1&&!e.lines[0]:!o.comparePoints(e.start,e.end))return;n&&e.lines.length>2e4?this.$splitAndapplyLargeDelta(e,2e4):(i(this.$lines,e,t),this._signal("change",e));},e.prototype.$safeApplyDelta=function(e){var t=this.$lines.length;(e.action=="remove"&&e.start.row<t&&e.end.row<t||e.action=="insert"&&e.start.row<=t)&&this.applyDelta(e);},e.prototype.$splitAndapplyLargeDelta=function(e,t){var n=e.lines,r=n.length-t+1,i=e.start.row,s=e.start.column;for(var o=0,u=0;o<r;o=u){u+=t-1;var a=n.slice(o,u);a.push(""),this.applyDelta({start:this.pos(i+o,s),end:this.pos(i+u,s=0),action:e.action,lines:a},!0);}e.lines=n.slice(o),e.start.row=i+o,e.start.column=s,this.applyDelta(e,!0);},e.prototype.revertDelta=function(e){this.$safeApplyDelta({start:this.clonePos(e.start),end:this.clonePos(e.end),action:e.action=="insert"?"remove":"insert",lines:e.lines.slice()});},e.prototype.indexToPosition=function(e,t){var n=this.$lines||this.getAllLines(),r=this.getNewLineCharacter().length;for(var i=t||0,s=n.length;i<s;i++){e-=n[i].length+r;if(e<0)return {row:i,column:e+n[i].length+r}}return {row:s-1,column:e+n[s-1].length+r}},e.prototype.positionToIndex=function(e,t){var n=this.$lines||this.getAllLines(),r=this.getNewLineCharacter().length,i=0,s=Math.min(e.row,n.length);for(var o=t||0;o<s;++o)i+=n[o].length+r;return i+e.column},e.prototype.$split=function(e){return e.split(/\r\n|\r|\n/)},e}();a.prototype.$autoNewLine="",a.prototype.$newLineMode="auto",r.implement(a.prototype,s),t.Document=a;}),ace.define("ace/background_tokenizer",["require","exports","module","ace/lib/oop","ace/lib/event_emitter"],function(e,t,n){var r=e("./lib/oop"),i=e("./lib/event_emitter").EventEmitter,s=function(){function e(e,t){this.running=!1,this.lines=[],this.states=[],this.currentLine=0,this.tokenizer=e;var n=this;this.$worker=function(){if(!n.running)return;var e=new Date,t=n.currentLine,r=-1,i=n.doc,s=t;while(n.lines[t])t++;var o=i.getLength(),u=0;n.running=!1;while(t<o){n.$tokenizeRow(t),r=t;do t++;while(n.lines[t]);u++;if(u%5===0&&new Date-e>20){n.running=setTimeout(n.$worker,20);break}}n.currentLine=t,r==-1&&(r=t),s<=r&&n.fireUpdateEvent(s,r);};}return e.prototype.setTokenizer=function(e){this.tokenizer=e,this.lines=[],this.states=[],this.start(0);},e.prototype.setDocument=function(e){this.doc=e,this.lines=[],this.states=[],this.stop();},e.prototype.fireUpdateEvent=function(e,t){var n={first:e,last:t};this._signal("update",{data:n});},e.prototype.start=function(e){this.currentLine=Math.min(e||0,this.currentLine,this.doc.getLength()),this.lines.splice(this.currentLine,this.lines.length),this.states.splice(this.currentLine,this.states.length),this.stop(),this.running=setTimeout(this.$worker,700);},e.prototype.scheduleStart=function(){this.running||(this.running=setTimeout(this.$worker,700));},e.prototype.$updateOnChange=function(e){var t=e.start.row,n=e.end.row-t;if(n===0)this.lines[t]=null;else if(e.action=="remove")this.lines.splice(t,n+1,null),this.states.splice(t,n+1,null);else {var r=Array(n+1);r.unshift(t,1),this.lines.splice.apply(this.lines,r),this.states.splice.apply(this.states,r);}this.currentLine=Math.min(t,this.currentLine,this.doc.getLength()),this.stop();},e.prototype.stop=function(){this.running&&clearTimeout(this.running),this.running=!1;},e.prototype.getTokens=function(e){return this.lines[e]||this.$tokenizeRow(e)},e.prototype.getState=function(e){return this.currentLine==e&&this.$tokenizeRow(e),this.states[e]||"start"},e.prototype.$tokenizeRow=function(e){var t=this.doc.getLine(e),n=this.states[e-1],r=this.tokenizer.getLineTokens(t,n,e);return this.states[e]+""!=r.state+""?(this.states[e]=r.state,this.lines[e+1]=null,this.currentLine>e+1&&(this.currentLine=e+1)):this.currentLine==e&&(this.currentLine=e+1),this.lines[e]=r.tokens},e.prototype.cleanup=function(){this.running=!1,this.lines=[],this.states=[],this.currentLine=0,this.removeAllListeners();},e}();r.implement(s.prototype,i),t.BackgroundTokenizer=s;}),ace.define("ace/search_highlight",["require","exports","module","ace/lib/lang","ace/range"],function(e,t,n){var r=e("./lib/lang"),i=e("./range").Range,s=function(){function e(e,t,n){n===void 0&&(n="text"),this.setRegexp(e),this.clazz=t,this.type=n;}return e.prototype.setRegexp=function(e){if(this.regExp+""==e+"")return;this.regExp=e,this.cache=[];},e.prototype.update=function(e,t,n,s){if(!this.regExp)return;var o=s.firstRow,u=s.lastRow,a={};for(var f=o;f<=u;f++){var l=this.cache[f];l==null&&(l=r.getMatchOffsets(n.getLine(f),this.regExp),l.length>this.MAX_RANGES&&(l=l.slice(0,this.MAX_RANGES)),l=l.map(function(e){return new i(f,e.offset,f,e.offset+e.length)}),this.cache[f]=l.length?l:"");for(var c=l.length;c--;){var h=l[c].toScreenRange(n),p=h.toString();if(a[p])continue;a[p]=!0,t.drawSingleLineMarker(e,h,this.clazz,s);}}},e}();s.prototype.MAX_RANGES=500,t.SearchHighlight=s;}),ace.define("ace/undomanager",["require","exports","module","ace/range"],function(e,t,n){function i(e,t){for(var n=t;n--;){var r=e[n];if(r&&!r[0].ignore){while(n<t-1){var i=d(e[n],e[n+1]);e[n]=i[0],e[n+1]=i[1],n++;}return !0}}}function f(e){return {row:e.row,column:e.column}}function l(e){return {start:f(e.start),end:f(e.end),action:e.action,lines:e.lines.slice()}}function c(e){e=e||this;if(Array.isArray(e))return e.map(c).join("\n");var t="";e.action?(t=e.action=="insert"?"+":"-",t+="["+e.lines+"]"):e.value&&(Array.isArray(e.value)?t=e.value.map(h).join("\n"):t=h(e.value)),e.start&&(t+=h(e));if(e.id||e.rev)t+="	("+(e.id||e.rev)+")";return t}function h(e){return e.start.row+":"+e.start.column+"=>"+e.end.row+":"+e.end.column}function p(e,t){var n=e.action=="insert",r=t.action=="insert";if(n&&r)if(o(t.start,e.end)>=0)m(t,e,-1);else {if(!(o(t.start,e.start)<=0))return null;m(e,t,1);}else if(n&&!r)if(o(t.start,e.end)>=0)m(t,e,-1);else {if(!(o(t.end,e.start)<=0))return null;m(e,t,-1);}else if(!n&&r)if(o(t.start,e.start)>=0)m(t,e,1);else {if(!(o(t.start,e.start)<=0))return null;m(e,t,1);}else if(!n&&!r)if(o(t.start,e.start)>=0)m(t,e,1);else {if(!(o(t.end,e.start)<=0))return null;m(e,t,-1);}return [t,e]}function d(e,t){for(var n=e.length;n--;)for(var r=0;r<t.length;r++)if(!p(e[n],t[r])){while(n<e.length){while(r--)p(t[r],e[n]);r=t.length,n++;}return [e,t]}return e.selectionBefore=t.selectionBefore=e.selectionAfter=t.selectionAfter=null,[t,e]}function v(e,t){var n=e.action=="insert",r=t.action=="insert";if(n&&r)o(e.start,t.start)<0?m(t,e,1):m(e,t,1);else if(n&&!r)o(e.start,t.end)>=0?m(e,t,-1):o(e.start,t.start)<=0?m(t,e,1):(m(e,s.fromPoints(t.start,e.start),-1),m(t,e,1));else if(!n&&r)o(t.start,e.end)>=0?m(t,e,-1):o(t.start,e.start)<=0?m(e,t,1):(m(t,s.fromPoints(e.start,t.start),-1),m(e,t,1));else if(!n&&!r)if(o(t.start,e.end)>=0)m(t,e,-1);else {if(!(o(t.end,e.start)<=0)){var i,u;return o(e.start,t.start)<0&&(i=e,e=y(e,t.start)),o(e.end,t.end)>0&&(u=y(e,t.end)),g(t.end,e.start,e.end,-1),u&&!i&&(e.lines=u.lines,e.start=u.start,e.end=u.end,u=e),[t,i,u].filter(Boolean)}m(e,t,-1);}return [t,e]}function m(e,t,n){g(e.start,t.start,t.end,n),g(e.end,t.start,t.end,n);}function g(e,t,n,r){e.row==(r==1?t:n).row&&(e.column+=r*(n.column-t.column)),e.row+=r*(n.row-t.row);}function y(e,t){var n=e.lines,r=e.end;e.end=f(t);var i=e.end.row-e.start.row,s=n.splice(i,n.length),o=i?t.column:t.column-e.start.column;n.push(s[0].substring(0,o)),s[0]=s[0].substr(o);var u={start:f(t),end:r,lines:s,action:e.action};return u}function b(e,t){t=l(t);for(var n=e.length;n--;){var r=e[n];for(var i=0;i<r.length;i++){var s=r[i],o=v(s,t);t=o[0],o.length!=2&&(o[2]?(r.splice(i+1,1,o[1],o[2]),i++):o[1]||(r.splice(i,1),i--));}r.length||e.splice(n,1);}return e}function w(e,t){for(var n=0;n<t.length;n++){var r=t[n];for(var i=0;i<r.length;i++)b(e,r[i]);}}var r=function(){function e(){this.$maxRev=0,this.$fromUndo=!1,this.$undoDepth=Infinity,this.reset();}return e.prototype.addSession=function(e){this.$session=e;},e.prototype.add=function(e,t,n){if(this.$fromUndo)return;if(e==this.$lastDelta)return;this.$keepRedoStack||(this.$redoStack.length=0);if(t===!1||!this.lastDeltas){this.lastDeltas=[];var r=this.$undoStack.length;r>this.$undoDepth-1&&this.$undoStack.splice(0,r-this.$undoDepth+1),this.$undoStack.push(this.lastDeltas),e.id=this.$rev=++this.$maxRev;}if(e.action=="remove"||e.action=="insert")this.$lastDelta=e;this.lastDeltas.push(e);},e.prototype.addSelection=function(e,t){this.selections.push({value:e,rev:t||this.$rev});},e.prototype.startNewGroup=function(){return this.lastDeltas=null,this.$rev},e.prototype.markIgnored=function(e,t){t==null&&(t=this.$rev+1);var n=this.$undoStack;for(var r=n.length;r--;){var i=n[r][0];if(i.id<=e)break;i.id<t&&(i.ignore=!0);}this.lastDeltas=null;},e.prototype.getSelection=function(e,t){var n=this.selections;for(var r=n.length;r--;){var i=n[r];if(i.rev<e)return t&&(i=n[r+1]),i}},e.prototype.getRevision=function(){return this.$rev},e.prototype.getDeltas=function(e,t){t==null&&(t=this.$rev+1);var n=this.$undoStack,r=null,i=0;for(var s=n.length;s--;){var o=n[s][0];o.id<t&&!r&&(r=s+1);if(o.id<=e){i=s+1;break}}return n.slice(i,r)},e.prototype.getChangedRanges=function(e,t){t==null&&(t=this.$rev+1);},e.prototype.getChangedLines=function(e,t){t==null&&(t=this.$rev+1);},e.prototype.undo=function(e,t){this.lastDeltas=null;var n=this.$undoStack;if(!i(n,n.length))return;e||(e=this.$session),this.$redoStackBaseRev!==this.$rev&&this.$redoStack.length&&(this.$redoStack=[]),this.$fromUndo=!0;var r=n.pop(),s=null;return r&&(s=e.undoChanges(r,t),this.$redoStack.push(r),this.$syncRev()),this.$fromUndo=!1,s},e.prototype.redo=function(e,t){this.lastDeltas=null,e||(e=this.$session),this.$fromUndo=!0;if(this.$redoStackBaseRev!=this.$rev){var n=this.getDeltas(this.$redoStackBaseRev,this.$rev+1);w(this.$redoStack,n),this.$redoStackBaseRev=this.$rev,this.$redoStack.forEach(function(e){e[0].id=++this.$maxRev;},this);}var r=this.$redoStack.pop(),i=null;return r&&(i=e.redoChanges(r,t),this.$undoStack.push(r),this.$syncRev()),this.$fromUndo=!1,i},e.prototype.$syncRev=function(){var e=this.$undoStack,t=e[e.length-1],n=t&&t[0].id||0;this.$redoStackBaseRev=n,this.$rev=n;},e.prototype.reset=function(){this.lastDeltas=null,this.$lastDelta=null,this.$undoStack=[],this.$redoStack=[],this.$rev=0,this.mark=0,this.$redoStackBaseRev=this.$rev,this.selections=[];},e.prototype.canUndo=function(){return this.$undoStack.length>0},e.prototype.canRedo=function(){return this.$redoStack.length>0},e.prototype.bookmark=function(e){e==undefined&&(e=this.$rev),this.mark=e;},e.prototype.isAtBookmark=function(){return this.$rev===this.mark},e.prototype.toJSON=function(){return {$redoStack:this.$redoStack,$undoStack:this.$undoStack}},e.prototype.fromJSON=function(e){this.reset(),this.$undoStack=e.$undoStack,this.$redoStack=e.$redoStack;},e.prototype.$prettyPrint=function(e){return e?c(e):c(this.$undoStack)+"\n---\n"+c(this.$redoStack)},e}();r.prototype.hasUndo=r.prototype.canUndo,r.prototype.hasRedo=r.prototype.canRedo,r.prototype.isClean=r.prototype.isAtBookmark,r.prototype.markClean=r.prototype.bookmark;var s=e("./range").Range,o=s.comparePoints;s.comparePoints;t.UndoManager=r;}),ace.define("ace/edit_session/fold_line",["require","exports","module","ace/range"],function(e,t,n){var r=e("../range").Range,i=function(){function e(e,t){this.foldData=e,Array.isArray(t)?this.folds=t:t=this.folds=[t];var n=t[t.length-1];this.range=new r(t[0].start.row,t[0].start.column,n.end.row,n.end.column),this.start=this.range.start,this.end=this.range.end,this.folds.forEach(function(e){e.setFoldLine(this);},this);}return e.prototype.shiftRow=function(e){this.start.row+=e,this.end.row+=e,this.folds.forEach(function(t){t.start.row+=e,t.end.row+=e;});},e.prototype.addFold=function(e){if(e.sameRow){if(e.start.row<this.startRow||e.endRow>this.endRow)throw new Error("Can't add a fold to this FoldLine as it has no connection");this.folds.push(e),this.folds.sort(function(e,t){return -e.range.compareEnd(t.start.row,t.start.column)}),this.range.compareEnd(e.start.row,e.start.column)>0?(this.end.row=e.end.row,this.end.column=e.end.column):this.range.compareStart(e.end.row,e.end.column)<0&&(this.start.row=e.start.row,this.start.column=e.start.column);}else if(e.start.row==this.end.row)this.folds.push(e),this.end.row=e.end.row,this.end.column=e.end.column;else {if(e.end.row!=this.start.row)throw new Error("Trying to add fold to FoldRow that doesn't have a matching row");this.folds.unshift(e),this.start.row=e.start.row,this.start.column=e.start.column;}e.foldLine=this;},e.prototype.containsRow=function(e){return e>=this.start.row&&e<=this.end.row},e.prototype.walk=function(e,t,n){var r=0,i=this.folds,s,o,u,a=!0;t==null&&(t=this.end.row,n=this.end.column);for(var f=0;f<i.length;f++){s=i[f],o=s.range.compareStart(t,n);if(o==-1){e(null,t,n,r,a);return}u=e(null,s.start.row,s.start.column,r,a),u=!u&&e(s.placeholder,s.start.row,s.start.column,r);if(u||o===0)return;a=!s.sameRow,r=s.end.column;}e(null,t,n,r,a);},e.prototype.getNextFoldTo=function(e,t){var n,r;for(var i=0;i<this.folds.length;i++){n=this.folds[i],r=n.range.compareEnd(e,t);if(r==-1)return {fold:n,kind:"after"};if(r===0)return {fold:n,kind:"inside"}}return null},e.prototype.addRemoveChars=function(e,t,n){var r=this.getNextFoldTo(e,t),i,s;if(r){i=r.fold;if(r.kind=="inside"&&i.start.column!=t&&i.start.row!=e)window.console&&window.console.log(e,t,i);else if(i.start.row==e){s=this.folds;var o=s.indexOf(i);o===0&&(this.start.column+=n);for(o;o<s.length;o++){i=s[o],i.start.column+=n;if(!i.sameRow)return;i.end.column+=n;}this.end.column+=n;}}},e.prototype.split=function(t,n){var r=this.getNextFoldTo(t,n);if(!r||r.kind=="inside")return null;var i=r.fold,s=this.folds,o=this.foldData,u=s.indexOf(i),a=s[u-1];this.end.row=a.end.row,this.end.column=a.end.column,s=s.splice(u,s.length-u);var f=new e(o,s);return o.splice(o.indexOf(this)+1,0,f),f},e.prototype.merge=function(e){var t=e.folds;for(var n=0;n<t.length;n++)this.addFold(t[n]);var r=this.foldData;r.splice(r.indexOf(e),1);},e.prototype.toString=function(){var e=[this.range.toString()+": ["];return this.folds.forEach(function(t){e.push("  "+t.toString());}),e.push("]"),e.join("\n")},e.prototype.idxToPosition=function(e){var t=0;for(var n=0;n<this.folds.length;n++){var r=this.folds[n];e-=r.start.column-t;if(e<0)return {row:r.start.row,column:r.start.column+e};e-=r.placeholder.length;if(e<0)return r.start;t=r.end.column;}return {row:this.end.row,column:this.end.column+e}},e}();t.FoldLine=i;}),ace.define("ace/range_list",["require","exports","module","ace/range"],function(e,t,n){var r=e("./range").Range,i=r.comparePoints,s=function(){function e(){this.ranges=[],this.$bias=1;}return e.prototype.pointIndex=function(e,t,n){var r=this.ranges;for(var s=n||0;s<r.length;s++){var o=r[s],u=i(e,o.end);if(u>0)continue;var a=i(e,o.start);return u===0?t&&a!==0?-s-2:s:a>0||a===0&&!t?s:-s-1}return -s-1},e.prototype.add=function(e){var t=!e.isEmpty(),n=this.pointIndex(e.start,t);n<0&&(n=-n-1);var r=this.pointIndex(e.end,t,n);return r<0?r=-r-1:r++,this.ranges.splice(n,r-n,e)},e.prototype.addList=function(e){var t=[];for(var n=e.length;n--;)t.push.apply(t,this.add(e[n]));return t},e.prototype.substractPoint=function(e){var t=this.pointIndex(e);if(t>=0)return this.ranges.splice(t,1)},e.prototype.merge=function(){var e=[],t=this.ranges;t=t.sort(function(e,t){return i(e.start,t.start)});var n=t[0],r;for(var s=1;s<t.length;s++){r=n,n=t[s];var o=i(r.end,n.start);if(o<0)continue;if(o==0&&!r.isEmpty()&&!n.isEmpty())continue;i(r.end,n.end)<0&&(r.end.row=n.end.row,r.end.column=n.end.column),t.splice(s,1),e.push(n),n=r,s--;}return this.ranges=t,e},e.prototype.contains=function(e,t){return this.pointIndex({row:e,column:t})>=0},e.prototype.containsPoint=function(e){return this.pointIndex(e)>=0},e.prototype.rangeAtPoint=function(e){var t=this.pointIndex(e);if(t>=0)return this.ranges[t]},e.prototype.clipRows=function(e,t){var n=this.ranges;if(n[0].start.row>t||n[n.length-1].start.row<e)return [];var r=this.pointIndex({row:e,column:0});r<0&&(r=-r-1);var i=this.pointIndex({row:t,column:0},r);i<0&&(i=-i-1);var s=[];for(var o=r;o<i;o++)s.push(n[o]);return s},e.prototype.removeAll=function(){return this.ranges.splice(0,this.ranges.length)},e.prototype.attach=function(e){this.session&&this.detach(),this.session=e,this.onChange=this.$onChange.bind(this),this.session.on("change",this.onChange);},e.prototype.detach=function(){if(!this.session)return;this.session.removeListener("change",this.onChange),this.session=null;},e.prototype.$onChange=function(e){var t=e.start,n=e.end,r=t.row,i=n.row,s=this.ranges;for(var o=0,u=s.length;o<u;o++){var a=s[o];if(a.end.row>=r)break}if(e.action=="insert"){var f=i-r,l=-t.column+n.column;for(;o<u;o++){var a=s[o];if(a.start.row>r)break;a.start.row==r&&a.start.column>=t.column&&(a.start.column==t.column&&this.$bias<=0||(a.start.column+=l,a.start.row+=f));if(a.end.row==r&&a.end.column>=t.column){if(a.end.column==t.column&&this.$bias<0)continue;a.end.column==t.column&&l>0&&o<u-1&&a.end.column>a.start.column&&a.end.column==s[o+1].start.column&&(a.end.column-=l),a.end.column+=l,a.end.row+=f;}}}else {var f=r-i,l=t.column-n.column;for(;o<u;o++){var a=s[o];if(a.start.row>i)break;if(a.end.row<i&&(r<a.end.row||r==a.end.row&&t.column<a.end.column))a.end.row=r,a.end.column=t.column;else if(a.end.row==i)if(a.end.column<=n.column){if(f||a.end.column>t.column)a.end.column=t.column,a.end.row=t.row;}else a.end.column+=l,a.end.row+=f;else a.end.row>i&&(a.end.row+=f);if(a.start.row<i&&(r<a.start.row||r==a.start.row&&t.column<a.start.column))a.start.row=r,a.start.column=t.column;else if(a.start.row==i)if(a.start.column<=n.column){if(f||a.start.column>t.column)a.start.column=t.column,a.start.row=t.row;}else a.start.column+=l,a.start.row+=f;else a.start.row>i&&(a.start.row+=f);}}if(f!=0&&o<u)for(;o<u;o++){var a=s[o];a.start.row+=f,a.end.row+=f;}},e}();s.prototype.comparePoints=i,t.RangeList=s;}),ace.define("ace/edit_session/fold",["require","exports","module","ace/range_list"],function(e,t,n){function o(e,t){e.row-=t.row,e.row==0&&(e.column-=t.column);}function u(e,t){o(e.start,t),o(e.end,t);}function a(e,t){e.row==0&&(e.column+=t.column),e.row+=t.row;}function f(e,t){a(e.start,t),a(e.end,t);}var r=this&&this.__extends||function(){var e=function(t,n){return e=Object.setPrototypeOf||{__proto__:[]}instanceof Array&&function(e,t){e.__proto__=t;}||function(e,t){for(var n in t)Object.prototype.hasOwnProperty.call(t,n)&&(e[n]=t[n]);},e(t,n)};return function(t,n){function r(){this.constructor=t;}if(typeof n!="function"&&n!==null)throw new TypeError("Class extends value "+String(n)+" is not a constructor or null");e(t,n),t.prototype=n===null?Object.create(n):(r.prototype=n.prototype,new r);}}(),i=e("../range_list").RangeList,s=function(e){function t(t,n){var r=e.call(this)||this;return r.foldLine=null,r.placeholder=n,r.range=t,r.start=t.start,r.end=t.end,r.sameRow=t.start.row==t.end.row,r.subFolds=r.ranges=[],r}return r(t,e),t.prototype.toString=function(){return '"'+this.placeholder+'" '+this.range.toString()},t.prototype.setFoldLine=function(e){this.foldLine=e,this.subFolds.forEach(function(t){t.setFoldLine(e);});},t.prototype.clone=function(){var e=this.range.clone(),n=new t(e,this.placeholder);return this.subFolds.forEach(function(e){n.subFolds.push(e.clone());}),n.collapseChildren=this.collapseChildren,n},t.prototype.addSubFold=function(e){if(this.range.isEqual(e))return;u(e,this.start);var t=e.start.row,n=e.start.column;for(var r=0,i=-1;r<this.subFolds.length;r++){i=this.subFolds[r].range.compare(t,n);if(i!=1)break}var s=this.subFolds[r],o=0;if(i==0){if(s.range.containsRange(e))return s.addSubFold(e);o=1;}var t=e.range.end.row,n=e.range.end.column;for(var a=r,i=-1;a<this.subFolds.length;a++){i=this.subFolds[a].range.compare(t,n);if(i!=1)break}i==0&&a++;var f=this.subFolds.splice(r,a-r,e),l=i==0?f.length-1:f.length;for(var c=o;c<l;c++)e.addSubFold(f[c]);return e.setFoldLine(this.foldLine),e},t.prototype.restoreRange=function(e){return f(e,this.start)},t}(i);t.Fold=s;}),ace.define("ace/edit_session/folding",["require","exports","module","ace/range","ace/edit_session/fold_line","ace/edit_session/fold","ace/token_iterator","ace/mouse/mouse_event"],function(e,t,n){function a(){this.getFoldAt=function(e,t,n){var r=this.getFoldLine(e);if(!r)return null;var i=r.folds;for(var s=0;s<i.length;s++){var o=i[s].range;if(o.contains(e,t)){if(n==1&&o.isEnd(e,t)&&!o.isEmpty())continue;if(n==-1&&o.isStart(e,t)&&!o.isEmpty())continue;return i[s]}}},this.getFoldsInRange=function(e){var t=e.start,n=e.end,r=this.$foldData,i=[];t.column+=1,n.column-=1;for(var s=0;s<r.length;s++){var o=r[s].range.compareRange(e);if(o==2)continue;if(o==-2)break;var u=r[s].folds;for(var a=0;a<u.length;a++){var f=u[a];o=f.range.compareRange(e);if(o==-2)break;if(o==2)continue;if(o==42)break;i.push(f);}}return t.column-=1,n.column+=1,i},this.getFoldsInRangeList=function(e){if(Array.isArray(e)){var t=[];e.forEach(function(e){t=t.concat(this.getFoldsInRange(e));},this);}else var t=this.getFoldsInRange(e);return t},this.getAllFolds=function(){var e=[],t=this.$foldData;for(var n=0;n<t.length;n++)for(var r=0;r<t[n].folds.length;r++)e.push(t[n].folds[r]);return e},this.getFoldStringAt=function(e,t,n,r){r=r||this.getFoldLine(e);if(!r)return null;var i={end:{column:0}},s,o;for(var u=0;u<r.folds.length;u++){o=r.folds[u];var a=o.range.compareEnd(e,t);if(a==-1){s=this.getLine(o.start.row).substring(i.end.column,o.start.column);break}if(a===0)return null;i=o;}return s||(s=this.getLine(o.start.row).substring(i.end.column)),n==-1?s.substring(0,t-i.end.column):n==1?s.substring(t-i.end.column):s},this.getFoldLine=function(e,t){var n=this.$foldData,r=0;t&&(r=n.indexOf(t)),r==-1&&(r=0);for(r;r<n.length;r++){var i=n[r];if(i.start.row<=e&&i.end.row>=e)return i;if(i.end.row>e)return null}return null},this.getNextFoldLine=function(e,t){var n=this.$foldData,r=0;t&&(r=n.indexOf(t)),r==-1&&(r=0);for(r;r<n.length;r++){var i=n[r];if(i.end.row>=e)return i}return null},this.getFoldedRowCount=function(e,t){var n=this.$foldData,r=t-e+1;for(var i=0;i<n.length;i++){var s=n[i],o=s.end.row,u=s.start.row;if(o>=t){u<t&&(u>=e?r-=t-u:r=0);break}o>=e&&(u>=e?r-=o-u:r-=o-e+1);}return r},this.$addFoldLine=function(e){return this.$foldData.push(e),this.$foldData.sort(function(e,t){return e.start.row-t.start.row}),e},this.addFold=function(e,t){var n=this.$foldData,r=!1,o;e instanceof s?o=e:(o=new s(t,e),o.collapseChildren=t.collapseChildren),this.$clipRangeToDocument(o.range);var u=o.start.row,a=o.start.column,f=o.end.row,l=o.end.column,c=this.getFoldAt(u,a,1),h=this.getFoldAt(f,l,-1);if(c&&h==c)return c.addSubFold(o);c&&!c.range.isStart(u,a)&&this.removeFold(c),h&&!h.range.isEnd(f,l)&&this.removeFold(h);var p=this.getFoldsInRange(o.range);p.length>0&&(this.removeFolds(p),o.collapseChildren||p.forEach(function(e){o.addSubFold(e);}));for(var d=0;d<n.length;d++){var v=n[d];if(f==v.start.row){v.addFold(o),r=!0;break}if(u==v.end.row){v.addFold(o),r=!0;if(!o.sameRow){var m=n[d+1];if(m&&m.start.row==f){v.merge(m);break}}break}if(f<=v.start.row)break}return r||(v=this.$addFoldLine(new i(this.$foldData,o))),this.$useWrapMode?this.$updateWrapData(v.start.row,v.start.row):this.$updateRowLengthCache(v.start.row,v.start.row),this.$modified=!0,this._signal("changeFold",{data:o,action:"add"}),o},this.addFolds=function(e){e.forEach(function(e){this.addFold(e);},this);},this.removeFold=function(e){var t=e.foldLine,n=t.start.row,r=t.end.row,i=this.$foldData,s=t.folds;if(s.length==1)i.splice(i.indexOf(t),1);else if(t.range.isEnd(e.end.row,e.end.column))s.pop(),t.end.row=s[s.length-1].end.row,t.end.column=s[s.length-1].end.column;else if(t.range.isStart(e.start.row,e.start.column))s.shift(),t.start.row=s[0].start.row,t.start.column=s[0].start.column;else if(e.sameRow)s.splice(s.indexOf(e),1);else {var o=t.split(e.start.row,e.start.column);s=o.folds,s.shift(),o.start.row=s[0].start.row,o.start.column=s[0].start.column;}this.$updating||(this.$useWrapMode?this.$updateWrapData(n,r):this.$updateRowLengthCache(n,r)),this.$modified=!0,this._signal("changeFold",{data:e,action:"remove"});},this.removeFolds=function(e){var t=[];for(var n=0;n<e.length;n++)t.push(e[n]);t.forEach(function(e){this.removeFold(e);},this),this.$modified=!0;},this.expandFold=function(e){this.removeFold(e),e.subFolds.forEach(function(t){e.restoreRange(t),this.addFold(t);},this),e.collapseChildren>0&&this.foldAll(e.start.row+1,e.end.row,e.collapseChildren-1),e.subFolds=[];},this.expandFolds=function(e){e.forEach(function(e){this.expandFold(e);},this);},this.unfold=function(e,t){var n,i;if(e==null)n=new r(0,0,this.getLength(),0),t==null&&(t=!0);else if(typeof e=="number")n=new r(e,0,e,this.getLine(e).length);else if("row"in e)n=r.fromPoints(e,e);else {if(Array.isArray(e))return i=[],e.forEach(function(e){i=i.concat(this.unfold(e));},this),i;n=e;}i=this.getFoldsInRangeList(n);var s=i;while(i.length==1&&r.comparePoints(i[0].start,n.start)<0&&r.comparePoints(i[0].end,n.end)>0)this.expandFolds(i),i=this.getFoldsInRangeList(n);t!=0?this.removeFolds(i):this.expandFolds(i);if(s.length)return s},this.isRowFolded=function(e,t){return !!this.getFoldLine(e,t)},this.getRowFoldEnd=function(e,t){var n=this.getFoldLine(e,t);return n?n.end.row:e},this.getRowFoldStart=function(e,t){var n=this.getFoldLine(e,t);return n?n.start.row:e},this.getFoldDisplayLine=function(e,t,n,r,i){r==null&&(r=e.start.row),i==null&&(i=0),t==null&&(t=e.end.row),n==null&&(n=this.getLine(t).length);var s=this.doc,o="";return e.walk(function(e,t,n,u){if(t<r)return;if(t==r){if(n<i)return;u=Math.max(i,u);}e!=null?o+=e:o+=s.getLine(t).substring(u,n);},t,n),o},this.getDisplayLine=function(e,t,n,r){var i=this.getFoldLine(e);if(!i){var s;return s=this.doc.getLine(e),s.substring(r||0,t||s.length)}return this.getFoldDisplayLine(i,e,t,n,r)},this.$cloneFoldData=function(){var e=[];return e=this.$foldData.map(function(t){var n=t.folds.map(function(e){return e.clone()});return new i(e,n)}),e},this.toggleFold=function(e){var t=this.selection,n=t.getRange(),r,i;if(n.isEmpty()){var s=n.start;r=this.getFoldAt(s.row,s.column);if(r){this.expandFold(r);return}(i=this.findMatchingBracket(s))?n.comparePoint(i)==1?n.end=i:(n.start=i,n.start.column++,n.end.column--):(i=this.findMatchingBracket({row:s.row,column:s.column+1}))?(n.comparePoint(i)==1?n.end=i:n.start=i,n.start.column++):n=this.getCommentFoldRange(s.row,s.column)||n;}else {var o=this.getFoldsInRange(n);if(e&&o.length){this.expandFolds(o);return}o.length==1&&(r=o[0]);}r||(r=this.getFoldAt(n.start.row,n.start.column));if(r&&r.range.toString()==n.toString()){this.expandFold(r);return}var u="...";if(!n.isMultiLine()){u=this.getTextRange(n);if(u.length<4)return;u=u.trim().substring(0,2)+"..";}this.addFold(u,n);},this.getCommentFoldRange=function(e,t,n){var i=new o(this,e,t),s=i.getCurrentToken(),u=s&&s.type;if(s&&/^comment|string/.test(u)){u=u.match(/comment|string/)[0],u=="comment"&&(u+="|doc-start|\\.doc");var a=new RegExp(u),f=new r;if(n!=1){do s=i.stepBackward();while(s&&a.test(s.type)&&!/^comment.end/.test(s.type));s=i.stepForward();}f.start.row=i.getCurrentTokenRow(),f.start.column=i.getCurrentTokenColumn()+(/^comment.start/.test(s.type)?s.value.length:2),i=new o(this,e,t);if(n!=-1){var l=-1;do{s=i.stepForward();if(l==-1){var c=this.getState(i.$row);a.test(c)||(l=i.$row);}else if(i.$row>l)break}while(s&&a.test(s.type)&&!/^comment.start/.test(s.type));s=i.stepBackward();}else s=i.getCurrentToken();return f.end.row=i.getCurrentTokenRow(),f.end.column=i.getCurrentTokenColumn(),/^comment.end/.test(s.type)||(f.end.column+=s.value.length-2),f}},this.foldAll=function(e,t,n,r){n==undefined&&(n=1e5);var i=this.foldWidgets;if(!i)return;t=t||this.getLength(),e=e||0;for(var s=e;s<t;s++){i[s]==null&&(i[s]=this.getFoldWidget(s));if(i[s]!="start")continue;if(r&&!r(s))continue;var o=this.getFoldWidgetRange(s);o&&o.isMultiLine()&&o.end.row<=t&&o.start.row>=e&&(s=o.end.row,o.collapseChildren=n,this.addFold("...",o));}},this.foldToLevel=function(e){this.foldAll();while(e-->0)this.unfold(null,!1);},this.foldAllComments=function(){var e=this;this.foldAll(null,null,null,function(t){var n=e.getTokens(t);for(var r=0;r<n.length;r++){var i=n[r];if(i.type=="text"&&/^\s+$/.test(i.value))continue;return /comment/.test(i.type)?!0:!1}});},this.$foldStyles={manual:1,markbegin:1,markbeginend:1},this.$foldStyle="markbegin",this.setFoldStyle=function(e){if(!this.$foldStyles[e])throw new Error("invalid fold style: "+e+"["+Object.keys(this.$foldStyles).join(", ")+"]");if(this.$foldStyle==e)return;this.$foldStyle=e,e=="manual"&&this.unfold();var t=this.$foldMode;this.$setFolding(null),this.$setFolding(t);},this.$setFolding=function(e){if(this.$foldMode==e)return;this.$foldMode=e,this.off("change",this.$updateFoldWidgets),this.off("tokenizerUpdate",this.$tokenizerUpdateFoldWidgets),this._signal("changeAnnotation");if(!e||this.$foldStyle=="manual"){this.foldWidgets=null;return}this.foldWidgets=[],this.getFoldWidget=e.getFoldWidget.bind(e,this,this.$foldStyle),this.getFoldWidgetRange=e.getFoldWidgetRange.bind(e,this,this.$foldStyle),this.$updateFoldWidgets=this.updateFoldWidgets.bind(this),this.$tokenizerUpdateFoldWidgets=this.tokenizerUpdateFoldWidgets.bind(this),this.on("change",this.$updateFoldWidgets),this.on("tokenizerUpdate",this.$tokenizerUpdateFoldWidgets);},this.getParentFoldRangeData=function(e,t){var n=this.foldWidgets;if(!n||t&&n[e])return {};var r=e-1,i;while(r>=0){var s=n[r];s==null&&(s=n[r]=this.getFoldWidget(r));if(s=="start"){var o=this.getFoldWidgetRange(r);i||(i=o);if(o&&o.end.row>=e)break}r--;}return {range:r!==-1&&o,firstRange:i}},this.onFoldWidgetClick=function(e,t){t instanceof u&&(t=t.domEvent);var n={children:t.shiftKey,all:t.ctrlKey||t.metaKey,siblings:t.altKey},r=this.$toggleFoldWidget(e,n);if(!r){var i=t.target||t.srcElement;i&&/ace_fold-widget/.test(i.className)&&(i.className+=" ace_invalid");}},this.$toggleFoldWidget=function(e,t){if(!this.getFoldWidget)return;var n=this.getFoldWidget(e),r=this.getLine(e),i=n==="end"?-1:1,s=this.getFoldAt(e,i===-1?0:r.length,i);if(s)return t.children||t.all?this.removeFold(s):this.expandFold(s),s;var o=this.getFoldWidgetRange(e,!0);if(o&&!o.isMultiLine()){s=this.getFoldAt(o.start.row,o.start.column,1);if(s&&o.isEqual(s.range))return this.removeFold(s),s}if(t.siblings){var u=this.getParentFoldRangeData(e);if(u.range)var a=u.range.start.row+1,f=u.range.end.row;this.foldAll(a,f,t.all?1e4:0);}else t.children?(f=o?o.end.row:this.getLength(),this.foldAll(e+1,f,t.all?1e4:0)):o&&(t.all&&(o.collapseChildren=1e4),this.addFold("...",o));return o},this.toggleFoldWidget=function(e){var t=this.selection.getCursor().row;t=this.getRowFoldStart(t);var n=this.$toggleFoldWidget(t,{});if(n)return;var r=this.getParentFoldRangeData(t,!0);n=r.range||r.firstRange;if(n){t=n.start.row;var i=this.getFoldAt(t,this.getLine(t).length,1);i?this.removeFold(i):this.addFold("...",n);}},this.updateFoldWidgets=function(e){var t=e.start.row,n=e.end.row-t;if(n===0)this.foldWidgets[t]=null;else if(e.action=="remove")this.foldWidgets.splice(t,n+1,null);else {var r=Array(n+1);r.unshift(t,1),this.foldWidgets.splice.apply(this.foldWidgets,r);}},this.tokenizerUpdateFoldWidgets=function(e){var t=e.data;t.first!=t.last&&this.foldWidgets.length>t.first&&this.foldWidgets.splice(t.first,this.foldWidgets.length);};}var r=e("../range").Range,i=e("./fold_line").FoldLine,s=e("./fold").Fold,o=e("../token_iterator").TokenIterator,u=e("../mouse/mouse_event").MouseEvent;t.Folding=a;}),ace.define("ace/edit_session/bracket_match",["require","exports","module","ace/token_iterator","ace/range"],function(e,t,n){function s(){this.findMatchingBracket=function(e,t){if(e.column==0)return null;var n=t||this.getLine(e.row).charAt(e.column-1);if(n=="")return null;var r=n.match(/([\(\[\{])|([\)\]\}])/);return r?r[1]?this.$findClosingBracket(r[1],e):this.$findOpeningBracket(r[2],e):null},this.getBracketRange=function(e){var t=this.getLine(e.row),n=!0,r,s=t.charAt(e.column-1),o=s&&s.match(/([\(\[\{])|([\)\]\}])/);o||(s=t.charAt(e.column),e={row:e.row,column:e.column+1},o=s&&s.match(/([\(\[\{])|([\)\]\}])/),n=!1);if(!o)return null;if(o[1]){var u=this.$findClosingBracket(o[1],e);if(!u)return null;r=i.fromPoints(e,u),n||(r.end.column++,r.start.column--),r.cursor=r.end;}else {var u=this.$findOpeningBracket(o[2],e);if(!u)return null;r=i.fromPoints(u,e),n||(r.start.column++,r.end.column--),r.cursor=r.start;}return r},this.getMatchingBracketRanges=function(e,t){var n=this.getLine(e.row),r=/([\(\[\{])|([\)\]\}])/,s=!t&&n.charAt(e.column-1),o=s&&s.match(r);o||(s=(t===undefined||t)&&n.charAt(e.column),e={row:e.row,column:e.column+1},o=s&&s.match(r));if(!o)return null;var u=new i(e.row,e.column-1,e.row,e.column),a=o[1]?this.$findClosingBracket(o[1],e):this.$findOpeningBracket(o[2],e);if(!a)return [u];var f=new i(a.row,a.column,a.row,a.column+1);return [u,f]},this.$brackets={")":"(","(":")","]":"[","[":"]","{":"}","}":"{","<":">",">":"<"},this.$findOpeningBracket=function(e,t,n){var i=this.$brackets[e],s=1,o=new r(this,t.row,t.column),u=o.getCurrentToken();u||(u=o.stepForward());if(!u)return;n||(n=new RegExp("(\\.?"+u.type.replace(".","\\.").replace("rparen",".paren").replace(/\b(?:end)\b/,"(?:start|begin|end)").replace(/-close\b/,"-(close|open)")+")+"));var a=t.column-o.getCurrentTokenColumn()-2,f=u.value;for(;;){while(a>=0){var l=f.charAt(a);if(l==i){s-=1;if(s==0)return {row:o.getCurrentTokenRow(),column:a+o.getCurrentTokenColumn()}}else l==e&&(s+=1);a-=1;}do u=o.stepBackward();while(u&&!n.test(u.type));if(u==null)break;f=u.value,a=f.length-1;}return null},this.$findClosingBracket=function(e,t,n){var i=this.$brackets[e],s=1,o=new r(this,t.row,t.column),u=o.getCurrentToken();u||(u=o.stepForward());if(!u)return;n||(n=new RegExp("(\\.?"+u.type.replace(".","\\.").replace("lparen",".paren").replace(/\b(?:start|begin)\b/,"(?:start|begin|end)").replace(/-open\b/,"-(close|open)")+")+"));var a=t.column-o.getCurrentTokenColumn();for(;;){var f=u.value,l=f.length;while(a<l){var c=f.charAt(a);if(c==i){s-=1;if(s==0)return {row:o.getCurrentTokenRow(),column:a+o.getCurrentTokenColumn()}}else c==e&&(s+=1);a+=1;}do u=o.stepForward();while(u&&!n.test(u.type));if(u==null)break;a=0;}return null},this.getMatchingTags=function(e){var t=new r(this,e.row,e.column),n=this.$findTagName(t);if(!n)return;var i=t.stepBackward();return i.value==="<"?this.$findClosingTag(t,n):this.$findOpeningTag(t,n)},this.$findTagName=function(e){var t=e.getCurrentToken(),n=!1,r=!1;if(t&&t.type.indexOf("tag-name")===-1)do r?t=e.stepBackward():t=e.stepForward(),t&&(t.value==="/>"?r=!0:t.type.indexOf("tag-name")!==-1&&(n=!0));while(t&&!n);return t},this.$findClosingTag=function(e,t){var n,r=t.value,s=t.value,o=0,u=new i(e.getCurrentTokenRow(),e.getCurrentTokenColumn(),e.getCurrentTokenRow(),e.getCurrentTokenColumn()+1);t=e.stepForward();var a=new i(e.getCurrentTokenRow(),e.getCurrentTokenColumn(),e.getCurrentTokenRow(),e.getCurrentTokenColumn()+t.value.length),f=!1;do{n=t,t=e.stepForward();if(t){if(t.value===">"&&!f){var l=new i(e.getCurrentTokenRow(),e.getCurrentTokenColumn(),e.getCurrentTokenRow(),e.getCurrentTokenColumn()+1);f=!0;}if(t.type.indexOf("tag-name")!==-1){r=t.value;if(s===r)if(n.value==="<")o++;else if(n.value==="</"){o--;if(o<0){e.stepBackward();var c=new i(e.getCurrentTokenRow(),e.getCurrentTokenColumn(),e.getCurrentTokenRow(),e.getCurrentTokenColumn()+2);t=e.stepForward();var h=new i(e.getCurrentTokenRow(),e.getCurrentTokenColumn(),e.getCurrentTokenRow(),e.getCurrentTokenColumn()+t.value.length);t=e.stepForward();if(!t||t.value!==">")return;var p=new i(e.getCurrentTokenRow(),e.getCurrentTokenColumn(),e.getCurrentTokenRow(),e.getCurrentTokenColumn()+1);}}}else if(s===r&&t.value==="/>"){o--;if(o<0)var c=new i(e.getCurrentTokenRow(),e.getCurrentTokenColumn(),e.getCurrentTokenRow(),e.getCurrentTokenColumn()+2),h=c,p=h,l=new i(a.end.row,a.end.column,a.end.row,a.end.column+1);}}}while(t&&o>=0);if(u&&l&&c&&p&&a&&h)return {openTag:new i(u.start.row,u.start.column,l.end.row,l.end.column),closeTag:new i(c.start.row,c.start.column,p.end.row,p.end.column),openTagName:a,closeTagName:h}},this.$findOpeningTag=function(e,t){var n=e.getCurrentToken(),r=t.value,s=0,o=e.getCurrentTokenRow(),u=e.getCurrentTokenColumn(),a=u+2,f=new i(o,u,o,a);e.stepForward();var l=new i(e.getCurrentTokenRow(),e.getCurrentTokenColumn(),e.getCurrentTokenRow(),e.getCurrentTokenColumn()+t.value.length);t=e.stepForward();if(!t||t.value!==">")return;var c=new i(e.getCurrentTokenRow(),e.getCurrentTokenColumn(),e.getCurrentTokenRow(),e.getCurrentTokenColumn()+1);e.stepBackward(),e.stepBackward();do{t=n,o=e.getCurrentTokenRow(),u=e.getCurrentTokenColumn(),a=u+t.value.length,n=e.stepBackward();if(t)if(t.type.indexOf("tag-name")!==-1){if(r===t.value)if(n.value==="<"){s++;if(s>0){var h=new i(o,u,o,a),p=new i(e.getCurrentTokenRow(),e.getCurrentTokenColumn(),e.getCurrentTokenRow(),e.getCurrentTokenColumn()+1);do t=e.stepForward();while(t&&t.value!==">");var d=new i(e.getCurrentTokenRow(),e.getCurrentTokenColumn(),e.getCurrentTokenRow(),e.getCurrentTokenColumn()+1);}}else n.value==="</"&&s--;}else if(t.value==="/>"){var v=0,m=n;while(m){if(m.type.indexOf("tag-name")!==-1&&m.value===r){s--;break}if(m.value==="<")break;m=e.stepBackward(),v++;}for(var g=0;g<v;g++)e.stepForward();}}while(n&&s<=0);if(p&&d&&f&&c&&h&&l)return {openTag:new i(p.start.row,p.start.column,d.end.row,d.end.column),closeTag:new i(f.start.row,f.start.column,c.end.row,c.end.column),openTagName:h,closeTagName:l}};}var r=e("../token_iterator").TokenIterator,i=e("../range").Range;t.BracketMatch=s;}),ace.define("ace/edit_session",["require","exports","module","ace/lib/oop","ace/lib/lang","ace/bidihandler","ace/config","ace/lib/event_emitter","ace/selection","ace/mode/text","ace/range","ace/document","ace/background_tokenizer","ace/search_highlight","ace/undomanager","ace/edit_session/folding","ace/edit_session/bracket_match"],function(e,t,n){function T(e){return e<4352?!1:e>=4352&&e<=4447||e>=4515&&e<=4519||e>=4602&&e<=4607||e>=9001&&e<=9002||e>=11904&&e<=11929||e>=11931&&e<=12019||e>=12032&&e<=12245||e>=12272&&e<=12283||e>=12288&&e<=12350||e>=12353&&e<=12438||e>=12441&&e<=12543||e>=12549&&e<=12589||e>=12593&&e<=12686||e>=12688&&e<=12730||e>=12736&&e<=12771||e>=12784&&e<=12830||e>=12832&&e<=12871||e>=12880&&e<=13054||e>=13056&&e<=19903||e>=19968&&e<=42124||e>=42128&&e<=42182||e>=43360&&e<=43388||e>=44032&&e<=55203||e>=55216&&e<=55238||e>=55243&&e<=55291||e>=63744&&e<=64255||e>=65040&&e<=65049||e>=65072&&e<=65106||e>=65108&&e<=65126||e>=65128&&e<=65131||e>=65281&&e<=65376||e>=65504&&e<=65510}var r=e("./lib/oop"),i=e("./lib/lang"),s=e("./bidihandler").BidiHandler,o=e("./config"),u=e("./lib/event_emitter").EventEmitter,a=e("./selection").Selection,f=e("./mode/text").Mode,l=e("./range").Range,c=e("./document").Document,h=e("./background_tokenizer").BackgroundTokenizer,p=e("./search_highlight").SearchHighlight,d=e("./undomanager").UndoManager,v=function(){function e(t,n){this.$breakpoints=[],this.$decorations=[],this.$frontMarkers={},this.$backMarkers={},this.$markerId=1,this.$undoSelect=!0,this.$foldData=[],this.id="session"+ ++e.$uid,this.$foldData.toString=function(){return this.join("\n")},this.bgTokenizer=new h((new f).getTokenizer(),this);var r=this;this.bgTokenizer.on("update",function(e){r._signal("tokenizerUpdate",e);}),this.on("changeFold",this.onChangeFold.bind(this)),this.$onChange=this.onChange.bind(this);if(typeof t!="object"||!t.getLine)t=new c(t);this.setDocument(t),this.selection=new a(this),this.$bidiHandler=new s(this),o.resetOptions(this),this.setMode(n),o._signal("session",this),this.destroyed=!1;}return e.prototype.setDocument=function(e){this.doc&&this.doc.off("change",this.$onChange),this.doc=e,e.on("change",this.$onChange,!0),this.bgTokenizer.setDocument(this.getDocument()),this.resetCaches();},e.prototype.getDocument=function(){return this.doc},e.prototype.$resetRowCache=function(e){if(!e){this.$docRowCache=[],this.$screenRowCache=[];return}var t=this.$docRowCache.length,n=this.$getRowCacheIndex(this.$docRowCache,e)+1;t>n&&(this.$docRowCache.splice(n,t),this.$screenRowCache.splice(n,t));},e.prototype.$getRowCacheIndex=function(e,t){var n=0,r=e.length-1;while(n<=r){var i=n+r>>1,s=e[i];if(t>s)n=i+1;else {if(!(t<s))return i;r=i-1;}}return n-1},e.prototype.resetCaches=function(){this.$modified=!0,this.$wrapData=[],this.$rowLengthCache=[],this.$resetRowCache(0),this.destroyed||this.bgTokenizer.start(0);},e.prototype.onChangeFold=function(e){var t=e.data;this.$resetRowCache(t.start.row);},e.prototype.onChange=function(e){this.$modified=!0,this.$bidiHandler.onChange(e),this.$resetRowCache(e.start.row);var t=this.$updateInternalDataOnChange(e);!this.$fromUndo&&this.$undoManager&&(t&&t.length&&(this.$undoManager.add({action:"removeFolds",folds:t},this.mergeUndoDeltas),this.mergeUndoDeltas=!0),this.$undoManager.add(e,this.mergeUndoDeltas),this.mergeUndoDeltas=!0,this.$informUndoManager.schedule()),this.bgTokenizer.$updateOnChange(e),this._signal("change",e);},e.prototype.setValue=function(e){this.doc.setValue(e),this.selection.moveTo(0,0),this.$resetRowCache(0),this.setUndoManager(this.$undoManager),this.getUndoManager().reset();},e.fromJSON=function(t){t=JSON.parse(t);var n=new d;n.$undoStack=t.history.undo,n.$redoStack=t.history.redo,n.mark=t.history.mark,n.$rev=t.history.rev;var r=new e(t.value);return t.folds.forEach(function(e){r.addFold("...",l.fromPoints(e.start,e.end));}),r.setAnnotations(t.annotations),r.setBreakpoints(t.breakpoints),r.setMode(t.mode),r.setScrollLeft(t.scrollLeft),r.setScrollTop(t.scrollTop),r.setUndoManager(n),r.selection.fromJSON(t.selection),r},e.prototype.toJSON=function(){return {annotations:this.$annotations,breakpoints:this.$breakpoints,folds:this.getAllFolds().map(function(e){return e.range}),history:this.getUndoManager(),mode:this.$mode.$id,scrollLeft:this.$scrollLeft,scrollTop:this.$scrollTop,selection:this.selection.toJSON(),value:this.doc.getValue()}},e.prototype.toString=function(){return this.doc.getValue()},e.prototype.getSelection=function(){return this.selection},e.prototype.getState=function(e){return this.bgTokenizer.getState(e)},e.prototype.getTokens=function(e){return this.bgTokenizer.getTokens(e)},e.prototype.getTokenAt=function(e,t){var n=this.bgTokenizer.getTokens(e),r,i=0;if(t==null){var s=n.length-1;i=this.getLine(e).length;}else for(var s=0;s<n.length;s++){i+=n[s].value.length;if(i>=t)break}return r=n[s],r?(r.index=s,r.start=i-r.value.length,r):null},e.prototype.setUndoManager=function(e){this.$undoManager=e,this.$informUndoManager&&this.$informUndoManager.cancel();if(e){var t=this;e.addSession(this),this.$syncInformUndoManager=function(){t.$informUndoManager.cancel(),t.mergeUndoDeltas=!1;},this.$informUndoManager=i.delayedCall(this.$syncInformUndoManager);}else this.$syncInformUndoManager=function(){};},e.prototype.markUndoGroup=function(){this.$syncInformUndoManager&&this.$syncInformUndoManager();},e.prototype.getUndoManager=function(){return this.$undoManager||this.$defaultUndoManager},e.prototype.getTabString=function(){return this.getUseSoftTabs()?i.stringRepeat(" ",this.getTabSize()):"	"},e.prototype.setUseSoftTabs=function(e){this.setOption("useSoftTabs",e);},e.prototype.getUseSoftTabs=function(){return this.$useSoftTabs&&!this.$mode.$indentWithTabs},e.prototype.setTabSize=function(e){this.setOption("tabSize",e);},e.prototype.getTabSize=function(){return this.$tabSize},e.prototype.isTabStop=function(e){return this.$useSoftTabs&&e.column%this.$tabSize===0},e.prototype.setNavigateWithinSoftTabs=function(e){this.setOption("navigateWithinSoftTabs",e);},e.prototype.getNavigateWithinSoftTabs=function(){return this.$navigateWithinSoftTabs},e.prototype.setOverwrite=function(e){this.setOption("overwrite",e);},e.prototype.getOverwrite=function(){return this.$overwrite},e.prototype.toggleOverwrite=function(){this.setOverwrite(!this.$overwrite);},e.prototype.addGutterDecoration=function(e,t){this.$decorations[e]||(this.$decorations[e]=""),this.$decorations[e]+=" "+t,this._signal("changeBreakpoint",{});},e.prototype.removeGutterDecoration=function(e,t){this.$decorations[e]=(this.$decorations[e]||"").replace(" "+t,""),this._signal("changeBreakpoint",{});},e.prototype.getBreakpoints=function(){return this.$breakpoints},e.prototype.setBreakpoints=function(e){this.$breakpoints=[];for(var t=0;t<e.length;t++)this.$breakpoints[e[t]]="ace_breakpoint";this._signal("changeBreakpoint",{});},e.prototype.clearBreakpoints=function(){this.$breakpoints=[],this._signal("changeBreakpoint",{});},e.prototype.setBreakpoint=function(e,t){t===undefined&&(t="ace_breakpoint"),t?this.$breakpoints[e]=t:delete this.$breakpoints[e],this._signal("changeBreakpoint",{});},e.prototype.clearBreakpoint=function(e){delete this.$breakpoints[e],this._signal("changeBreakpoint",{});},e.prototype.addMarker=function(e,t,n,r){var i=this.$markerId++,s={range:e,type:n||"line",renderer:typeof n=="function"?n:null,clazz:t,inFront:!!r,id:i};return r?(this.$frontMarkers[i]=s,this._signal("changeFrontMarker")):(this.$backMarkers[i]=s,this._signal("changeBackMarker")),i},e.prototype.addDynamicMarker=function(e,t){if(!e.update)return;var n=this.$markerId++;return e.id=n,e.inFront=!!t,t?(this.$frontMarkers[n]=e,this._signal("changeFrontMarker")):(this.$backMarkers[n]=e,this._signal("changeBackMarker")),e},e.prototype.removeMarker=function(e){var t=this.$frontMarkers[e]||this.$backMarkers[e];if(!t)return;var n=t.inFront?this.$frontMarkers:this.$backMarkers;delete n[e],this._signal(t.inFront?"changeFrontMarker":"changeBackMarker");},e.prototype.getMarkers=function(e){return e?this.$frontMarkers:this.$backMarkers},e.prototype.highlight=function(e){if(!this.$searchHighlight){var t=new p(null,"ace_selected-word","text");this.$searchHighlight=this.addDynamicMarker(t);}this.$searchHighlight.setRegexp(e);},e.prototype.highlightLines=function(e,t,n,r){typeof t!="number"&&(n=t,t=e),n||(n="ace_step");var i=new l(e,0,t,Infinity);return i.id=this.addMarker(i,n,"fullLine",r),i},e.prototype.setAnnotations=function(e){this.$annotations=e,this._signal("changeAnnotation",{});},e.prototype.getAnnotations=function(){return this.$annotations||[]},e.prototype.clearAnnotations=function(){this.setAnnotations([]);},e.prototype.$detectNewLine=function(e){var t=e.match(/^.*?(\r?\n)/m);t?this.$autoNewLine=t[1]:this.$autoNewLine="\n";},e.prototype.getWordRange=function(e,t){var n=this.getLine(e),r=!1;t>0&&(r=!!n.charAt(t-1).match(this.tokenRe)),r||(r=!!n.charAt(t).match(this.tokenRe));if(r)var i=this.tokenRe;else if(/^\s+$/.test(n.slice(t-1,t+1)))var i=/\s/;else var i=this.nonTokenRe;var s=t;if(s>0){do s--;while(s>=0&&n.charAt(s).match(i));s++;}var o=t;while(o<n.length&&n.charAt(o).match(i))o++;return new l(e,s,e,o)},e.prototype.getAWordRange=function(e,t){var n=this.getWordRange(e,t),r=this.getLine(n.end.row);while(r.charAt(n.end.column).match(/[ \t]/))n.end.column+=1;return n},e.prototype.setNewLineMode=function(e){this.doc.setNewLineMode(e);},e.prototype.getNewLineMode=function(){return this.doc.getNewLineMode()},e.prototype.setUseWorker=function(e){this.setOption("useWorker",e);},e.prototype.getUseWorker=function(){return this.$useWorker},e.prototype.onReloadTokenizer=function(e){var t=e.data;this.bgTokenizer.start(t.first),this._signal("tokenizerUpdate",e);},e.prototype.setMode=function(e,t){if(e&&typeof e=="object"){if(e.getTokenizer)return this.$onChangeMode(e);var n=e,r=n.path;}else r=e||"ace/mode/text";this.$modes["ace/mode/text"]||(this.$modes["ace/mode/text"]=new f);if(this.$modes[r]&&!n){this.$onChangeMode(this.$modes[r]),t&&t();return}this.$modeId=r,o.loadModule(["mode",r],function(e){if(this.$modeId!==r)return t&&t();this.$modes[r]&&!n?this.$onChangeMode(this.$modes[r]):e&&e.Mode&&(e=new e.Mode(n),n||(this.$modes[r]=e,e.$id=r),this.$onChangeMode(e)),t&&t();}.bind(this)),this.$mode||this.$onChangeMode(this.$modes["ace/mode/text"],!0);},e.prototype.$onChangeMode=function(e,t){t||(this.$modeId=e.$id);if(this.$mode===e)return;var n=this.$mode;this.$mode=e,this.$stopWorker(),this.$useWorker&&this.$startWorker();var r=e.getTokenizer();if(r.on!==undefined){var i=this.onReloadTokenizer.bind(this);r.on("update",i);}this.bgTokenizer.setTokenizer(r),this.bgTokenizer.setDocument(this.getDocument()),this.tokenRe=e.tokenRe,this.nonTokenRe=e.nonTokenRe,t||(e.attachToSession&&e.attachToSession(this),this.$options.wrapMethod.set.call(this,this.$wrapMethod),this.$setFolding(e.foldingRules),this.bgTokenizer.start(0),this._emit("changeMode",{oldMode:n,mode:e}));},e.prototype.$stopWorker=function(){this.$worker&&(this.$worker.terminate(),this.$worker=null);},e.prototype.$startWorker=function(){try{this.$worker=this.$mode.createWorker(this);}catch(e){o.warn("Could not load worker",e),this.$worker=null;}},e.prototype.getMode=function(){return this.$mode},e.prototype.setScrollTop=function(e){if(this.$scrollTop===e||isNaN(e))return;this.$scrollTop=e,this._signal("changeScrollTop",e);},e.prototype.getScrollTop=function(){return this.$scrollTop},e.prototype.setScrollLeft=function(e){if(this.$scrollLeft===e||isNaN(e))return;this.$scrollLeft=e,this._signal("changeScrollLeft",e);},e.prototype.getScrollLeft=function(){return this.$scrollLeft},e.prototype.getScreenWidth=function(){return this.$computeWidth(),this.lineWidgets?Math.max(this.getLineWidgetMaxWidth(),this.screenWidth):this.screenWidth},e.prototype.getLineWidgetMaxWidth=function(){if(this.lineWidgetsWidth!=null)return this.lineWidgetsWidth;var e=0;return this.lineWidgets.forEach(function(t){t&&t.screenWidth>e&&(e=t.screenWidth);}),this.lineWidgetWidth=e},e.prototype.$computeWidth=function(e){if(this.$modified||e){this.$modified=!1;if(this.$useWrapMode)return this.screenWidth=this.$wrapLimit;var t=this.doc.getAllLines(),n=this.$rowLengthCache,r=0,i=0,s=this.$foldData[i],o=s?s.start.row:Infinity,u=t.length;for(var a=0;a<u;a++){if(a>o){a=s.end.row+1;if(a>=u)break;s=this.$foldData[i++],o=s?s.start.row:Infinity;}n[a]==null&&(n[a]=this.$getStringScreenWidth(t[a])[0]),n[a]>r&&(r=n[a]);}this.screenWidth=r;}},e.prototype.getLine=function(e){return this.doc.getLine(e)},e.prototype.getLines=function(e,t){return this.doc.getLines(e,t)},e.prototype.getLength=function(){return this.doc.getLength()},e.prototype.getTextRange=function(e){return this.doc.getTextRange(e||this.selection.getRange())},e.prototype.insert=function(e,t){return this.doc.insert(e,t)},e.prototype.remove=function(e){return this.doc.remove(e)},e.prototype.removeFullLines=function(e,t){return this.doc.removeFullLines(e,t)},e.prototype.undoChanges=function(e,t){if(!e.length)return;this.$fromUndo=!0;for(var n=e.length-1;n!=-1;n--){var r=e[n];r.action=="insert"||r.action=="remove"?this.doc.revertDelta(r):r.folds&&this.addFolds(r.folds);}!t&&this.$undoSelect&&(e.selectionBefore?this.selection.fromJSON(e.selectionBefore):this.selection.setRange(this.$getUndoSelection(e,!0))),this.$fromUndo=!1;},e.prototype.redoChanges=function(e,t){if(!e.length)return;this.$fromUndo=!0;for(var n=0;n<e.length;n++){var r=e[n];(r.action=="insert"||r.action=="remove")&&this.doc.$safeApplyDelta(r);}!t&&this.$undoSelect&&(e.selectionAfter?this.selection.fromJSON(e.selectionAfter):this.selection.setRange(this.$getUndoSelection(e,!1))),this.$fromUndo=!1;},e.prototype.setUndoSelect=function(e){this.$undoSelect=e;},e.prototype.$getUndoSelection=function(e,t){function n(e){return t?e.action!=="insert":e.action==="insert"}var r,i;for(var s=0;s<e.length;s++){var o=e[s];if(!o.start)continue;if(!r){n(o)?r=l.fromPoints(o.start,o.end):r=l.fromPoints(o.start,o.start);continue}n(o)?(i=o.start,r.compare(i.row,i.column)==-1&&r.setStart(i),i=o.end,r.compare(i.row,i.column)==1&&r.setEnd(i)):(i=o.start,r.compare(i.row,i.column)==-1&&(r=l.fromPoints(o.start,o.start)));}return r},e.prototype.replace=function(e,t){return this.doc.replace(e,t)},e.prototype.moveText=function(e,t,n){var r=this.getTextRange(e),i=this.getFoldsInRange(e),s=l.fromPoints(t,t);if(!n){this.remove(e);var o=e.start.row-e.end.row,u=o?-e.end.column:e.start.column-e.end.column;u&&(s.start.row==e.end.row&&s.start.column>e.end.column&&(s.start.column+=u),s.end.row==e.end.row&&s.end.column>e.end.column&&(s.end.column+=u)),o&&s.start.row>=e.end.row&&(s.start.row+=o,s.end.row+=o);}s.end=this.insert(s.start,r);if(i.length){var a=e.start,f=s.start,o=f.row-a.row,u=f.column-a.column;this.addFolds(i.map(function(e){return e=e.clone(),e.start.row==a.row&&(e.start.column+=u),e.end.row==a.row&&(e.end.column+=u),e.start.row+=o,e.end.row+=o,e}));}return s},e.prototype.indentRows=function(e,t,n){n=n.replace(/\t/g,this.getTabString());for(var r=e;r<=t;r++)this.doc.insertInLine({row:r,column:0},n);},e.prototype.outdentRows=function(e){var t=e.collapseRows(),n=new l(0,0,0,0),r=this.getTabSize();for(var i=t.start.row;i<=t.end.row;++i){var s=this.getLine(i);n.start.row=i,n.end.row=i;for(var o=0;o<r;++o)if(s.charAt(o)!=" ")break;o<r&&s.charAt(o)=="	"?(n.start.column=o,n.end.column=o+1):(n.start.column=0,n.end.column=o),this.remove(n);}},e.prototype.$moveLines=function(e,t,n){e=this.getRowFoldStart(e),t=this.getRowFoldEnd(t);if(n<0){var r=this.getRowFoldStart(e+n);if(r<0)return 0;var i=r-e;}else if(n>0){var r=this.getRowFoldEnd(t+n);if(r>this.doc.getLength()-1)return 0;var i=r-t;}else {e=this.$clipRowToDocument(e),t=this.$clipRowToDocument(t);var i=t-e+1;}var s=new l(e,0,t,Number.MAX_VALUE),o=this.getFoldsInRange(s).map(function(e){return e=e.clone(),e.start.row+=i,e.end.row+=i,e}),u=n==0?this.doc.getLines(e,t):this.doc.removeFullLines(e,t);return this.doc.insertFullLines(e+i,u),o.length&&this.addFolds(o),i},e.prototype.moveLinesUp=function(e,t){return this.$moveLines(e,t,-1)},e.prototype.moveLinesDown=function(e,t){return this.$moveLines(e,t,1)},e.prototype.duplicateLines=function(e,t){return this.$moveLines(e,t,0)},e.prototype.$clipRowToDocument=function(e){return Math.max(0,Math.min(e,this.doc.getLength()-1))},e.prototype.$clipColumnToRow=function(e,t){return t<0?0:Math.min(this.doc.getLine(e).length,t)},e.prototype.$clipPositionToDocument=function(e,t){t=Math.max(0,t);if(e<0)e=0,t=0;else {var n=this.doc.getLength();e>=n?(e=n-1,t=this.doc.getLine(n-1).length):t=Math.min(this.doc.getLine(e).length,t);}return {row:e,column:t}},e.prototype.$clipRangeToDocument=function(e){e.start.row<0?(e.start.row=0,e.start.column=0):e.start.column=this.$clipColumnToRow(e.start.row,e.start.column);var t=this.doc.getLength()-1;return e.end.row>t?(e.end.row=t,e.end.column=this.doc.getLine(t).length):e.end.column=this.$clipColumnToRow(e.end.row,e.end.column),e},e.prototype.setUseWrapMode=function(e){if(e!=this.$useWrapMode){this.$useWrapMode=e,this.$modified=!0,this.$resetRowCache(0);if(e){var t=this.getLength();this.$wrapData=Array(t),this.$updateWrapData(0,t-1);}this._signal("changeWrapMode");}},e.prototype.getUseWrapMode=function(){return this.$useWrapMode},e.prototype.setWrapLimitRange=function(e,t){if(this.$wrapLimitRange.min!==e||this.$wrapLimitRange.max!==t)this.$wrapLimitRange={min:e,max:t},this.$modified=!0,this.$bidiHandler.markAsDirty(),this.$useWrapMode&&this._signal("changeWrapMode");},e.prototype.adjustWrapLimit=function(e,t){var n=this.$wrapLimitRange;n.max<0&&(n={min:t,max:t});var r=this.$constrainWrapLimit(e,n.min,n.max);return r!=this.$wrapLimit&&r>1?(this.$wrapLimit=r,this.$modified=!0,this.$useWrapMode&&(this.$updateWrapData(0,this.getLength()-1),this.$resetRowCache(0),this._signal("changeWrapLimit")),!0):!1},e.prototype.$constrainWrapLimit=function(e,t,n){return t&&(e=Math.max(t,e)),n&&(e=Math.min(n,e)),e},e.prototype.getWrapLimit=function(){return this.$wrapLimit},e.prototype.setWrapLimit=function(e){this.setWrapLimitRange(e,e);},e.prototype.getWrapLimitRange=function(){return {min:this.$wrapLimitRange.min,max:this.$wrapLimitRange.max}},e.prototype.$updateInternalDataOnChange=function(e){var t=this.$useWrapMode,n=e.action,r=e.start,i=e.end,s=r.row,o=i.row,u=o-s,a=null;this.$updating=!0;if(u!=0)if(n==="remove"){this[t?"$wrapData":"$rowLengthCache"].splice(s,u);var f=this.$foldData;a=this.getFoldsInRange(e),this.removeFolds(a);var l=this.getFoldLine(i.row),c=0;if(l){l.addRemoveChars(i.row,i.column,r.column-i.column),l.shiftRow(-u);var h=this.getFoldLine(s);h&&h!==l&&(h.merge(l),l=h),c=f.indexOf(l)+1;}for(c;c<f.length;c++){var l=f[c];l.start.row>=i.row&&l.shiftRow(-u);}o=s;}else {var p=Array(u);p.unshift(s,0);var d=t?this.$wrapData:this.$rowLengthCache;d.splice.apply(d,p);var f=this.$foldData,l=this.getFoldLine(s),c=0;if(l){var v=l.range.compareInside(r.row,r.column);v==0?(l=l.split(r.row,r.column),l&&(l.shiftRow(u),l.addRemoveChars(o,0,i.column-r.column))):v==-1&&(l.addRemoveChars(s,0,i.column-r.column),l.shiftRow(u)),c=f.indexOf(l)+1;}for(c;c<f.length;c++){var l=f[c];l.start.row>=s&&l.shiftRow(u);}}else {u=Math.abs(e.start.column-e.end.column),n==="remove"&&(a=this.getFoldsInRange(e),this.removeFolds(a),u=-u);var l=this.getFoldLine(s);l&&l.addRemoveChars(s,r.column,u);}return t&&this.$wrapData.length!=this.doc.getLength()&&console.error("doc.getLength() and $wrapData.length have to be the same!"),this.$updating=!1,t?this.$updateWrapData(s,o):this.$updateRowLengthCache(s,o),a},e.prototype.$updateRowLengthCache=function(e,t,n){this.$rowLengthCache[e]=null,this.$rowLengthCache[t]=null;},e.prototype.$updateWrapData=function(e,t){var n=this.doc.getAllLines(),r=this.getTabSize(),i=this.$wrapData,s=this.$wrapLimit,o,u,a=e;t=Math.min(t,n.length-1);while(a<=t)u=this.getFoldLine(a,u),u?(o=[],u.walk(function(e,t,r,i){var s;if(e!=null){s=this.$getDisplayTokens(e,o.length),s[0]=y;for(var u=1;u<s.length;u++)s[u]=b;}else s=this.$getDisplayTokens(n[t].substring(i,r),o.length);o=o.concat(s);}.bind(this),u.end.row,n[u.end.row].length+1),i[u.start.row]=this.$computeWrapSplits(o,s,r),a=u.end.row+1):(o=this.$getDisplayTokens(n[a]),i[a]=this.$computeWrapSplits(o,s,r),a++);},e.prototype.$computeWrapSplits=function(e,t,n){function l(){var t=0;if(f===0)return t;if(a)for(var r=0;r<e.length;r++){var i=e[r];if(i==E)t+=1;else {if(i!=S){if(i==x)continue;break}t+=n;}}return u&&a!==!1&&(t+=n),Math.min(t,f)}function c(t){var n=t-s;for(var i=s;i<t;i++){var u=e[i];if(u===12||u===2)n-=1;}r.length||(h=l(),r.indent=h),o+=n,r.push(o),s=t;}if(e.length==0)return [];var r=[],i=e.length,s=0,o=0,u=this.$wrapAsCode,a=this.$indentedSoftWrap,f=t<=Math.max(2*n,8)||a===!1?0:Math.floor(t/2),h=0;while(i-s>t-h){var p=s+t-h;if(e[p-1]>=E&&e[p]>=E){c(p);continue}if(e[p]==y||e[p]==b){for(p;p!=s-1;p--)if(e[p]==y)break;if(p>s){c(p);continue}p=s+t;for(p;p<e.length;p++)if(e[p]!=b)break;if(p==e.length)break;c(p);continue}var d=Math.max(p-(t-(t>>2)),s-1);while(p>d&&e[p]<y)p--;if(u){while(p>d&&e[p]<y)p--;while(p>d&&e[p]==w)p--;}else while(p>d&&e[p]<E)p--;if(p>d){c(++p);continue}p=s+t,e[p]==g&&p--,c(p-h);}return r},e.prototype.$getDisplayTokens=function(e,t){var n=[],r;t=t||0;for(var i=0;i<e.length;i++){var s=e.charCodeAt(i);if(s==9){r=this.getScreenTabSize(n.length+t),n.push(S);for(var o=1;o<r;o++)n.push(x);}else s==32?n.push(E):s>39&&s<48||s>57&&s<64?n.push(w):s>=4352&&T(s)?n.push(m,g):n.push(m);}return n},e.prototype.$getStringScreenWidth=function(e,t,n){if(t==0)return [0,0];t==null&&(t=Infinity),n=n||0;var r,i;for(i=0;i<e.length;i++){r=e.charCodeAt(i),r==9?n+=this.getScreenTabSize(n):r>=4352&&T(r)?n+=2:n+=1;if(n>t)break}return [n,i]},e.prototype.getRowLength=function(e){var t=1;return this.lineWidgets&&(t+=this.lineWidgets[e]&&this.lineWidgets[e].rowCount||0),!this.$useWrapMode||!this.$wrapData[e]?t:this.$wrapData[e].length+t},e.prototype.getRowLineCount=function(e){return !this.$useWrapMode||!this.$wrapData[e]?1:this.$wrapData[e].length+1},e.prototype.getRowWrapIndent=function(e){if(this.$useWrapMode){var t=this.screenToDocumentPosition(e,Number.MAX_VALUE),n=this.$wrapData[t.row];return n.length&&n[0]<t.column?n.indent:0}return 0},e.prototype.getScreenLastRowColumn=function(e){var t=this.screenToDocumentPosition(e,Number.MAX_VALUE);return this.documentToScreenColumn(t.row,t.column)},e.prototype.getDocumentLastRowColumn=function(e,t){var n=this.documentToScreenRow(e,t);return this.getScreenLastRowColumn(n)},e.prototype.getDocumentLastRowColumnPosition=function(e,t){var n=this.documentToScreenRow(e,t);return this.screenToDocumentPosition(n,Number.MAX_VALUE/10)},e.prototype.getRowSplitData=function(e){return this.$useWrapMode?this.$wrapData[e]:undefined},e.prototype.getScreenTabSize=function(e){return this.$tabSize-(e%this.$tabSize|0)},e.prototype.screenToDocumentRow=function(e,t){return this.screenToDocumentPosition(e,t).row},e.prototype.screenToDocumentColumn=function(e,t){return this.screenToDocumentPosition(e,t).column},e.prototype.screenToDocumentPosition=function(e,t,n){if(e<0)return {row:0,column:0};var r,i=0,s=0,o,u=0,a=0,f=this.$screenRowCache,l=this.$getRowCacheIndex(f,e),c=f.length;if(c&&l>=0)var u=f[l],i=this.$docRowCache[l],h=e>f[c-1];else var h=!c;var p=this.getLength()-1,d=this.getNextFoldLine(i),v=d?d.start.row:Infinity;while(u<=e){a=this.getRowLength(i);if(u+a>e||i>=p)break;u+=a,i++,i>v&&(i=d.end.row+1,d=this.getNextFoldLine(i,d),v=d?d.start.row:Infinity),h&&(this.$docRowCache.push(i),this.$screenRowCache.push(u));}if(d&&d.start.row<=i)r=this.getFoldDisplayLine(d),i=d.start.row;else {if(u+a<=e||i>p)return {row:p,column:this.getLine(p).length};r=this.getLine(i),d=null;}var m=0,g=Math.floor(e-u);if(this.$useWrapMode){var y=this.$wrapData[i];y&&(o=y[g],g>0&&y.length&&(m=y.indent,s=y[g-1]||y[y.length-1],r=r.substring(s)));}return n!==undefined&&this.$bidiHandler.isBidiRow(u+g,i,g)&&(t=this.$bidiHandler.offsetToCol(n)),s+=this.$getStringScreenWidth(r,t-m)[1],this.$useWrapMode&&s>=o&&(s=o-1),d?d.idxToPosition(s):{row:i,column:s}},e.prototype.documentToScreenPosition=function(e,t){if(typeof t=="undefined")var n=this.$clipPositionToDocument(e.row,e.column);else n=this.$clipPositionToDocument(e,t);e=n.row,t=n.column;var r=0,i=null,s=null;s=this.getFoldAt(e,t,1),s&&(e=s.start.row,t=s.start.column);var o,u=0,a=this.$docRowCache,f=this.$getRowCacheIndex(a,e),l=a.length;if(l&&f>=0)var u=a[f],r=this.$screenRowCache[f],c=e>a[l-1];else var c=!l;var h=this.getNextFoldLine(u),p=h?h.start.row:Infinity;while(u<e){if(u>=p){o=h.end.row+1;if(o>e)break;h=this.getNextFoldLine(o,h),p=h?h.start.row:Infinity;}else o=u+1;r+=this.getRowLength(u),u=o,c&&(this.$docRowCache.push(u),this.$screenRowCache.push(r));}var d="";h&&u>=p?(d=this.getFoldDisplayLine(h,e,t),i=h.start.row):(d=this.getLine(e).substring(0,t),i=e);var v=0;if(this.$useWrapMode){var m=this.$wrapData[i];if(m){var g=0;while(d.length>=m[g])r++,g++;d=d.substring(m[g-1]||0,d.length),v=g>0?m.indent:0;}}return this.lineWidgets&&this.lineWidgets[u]&&this.lineWidgets[u].rowsAbove&&(r+=this.lineWidgets[u].rowsAbove),{row:r,column:v+this.$getStringScreenWidth(d)[0]}},e.prototype.documentToScreenColumn=function(e,t){return this.documentToScreenPosition(e,t).column},e.prototype.documentToScreenRow=function(e,t){return this.documentToScreenPosition(e,t).row},e.prototype.getScreenLength=function(){var e=0,t=null;if(!this.$useWrapMode){e=this.getLength();var n=this.$foldData;for(var r=0;r<n.length;r++)t=n[r],e-=t.end.row-t.start.row;}else {var i=this.$wrapData.length,s=0,r=0,t=this.$foldData[r++],o=t?t.start.row:Infinity;while(s<i){var u=this.$wrapData[s];e+=u?u.length+1:1,s++,s>o&&(s=t.end.row+1,t=this.$foldData[r++],o=t?t.start.row:Infinity);}}return this.lineWidgets&&(e+=this.$getWidgetScreenLength()),e},e.prototype.$setFontMetrics=function(e){if(!this.$enableVarChar)return;this.$getStringScreenWidth=function(t,n,r){if(n===0)return [0,0];n||(n=Infinity),r=r||0;var i,s;for(s=0;s<t.length;s++){i=t.charAt(s),i==="	"?r+=this.getScreenTabSize(r):r+=e.getCharacterWidth(i);if(r>n)break}return [r,s]};},e.prototype.destroy=function(){this.destroyed||(this.bgTokenizer.setDocument(null),this.bgTokenizer.cleanup(),this.destroyed=!0),this.$stopWorker(),this.removeAllListeners(),this.doc&&this.doc.off("change",this.$onChange),this.selection.detach();},e}();v.$uid=0,v.prototype.$modes=o.$modes,v.prototype.getValue=v.prototype.toString,v.prototype.$defaultUndoManager={undo:function(){},redo:function(){},hasUndo:function(){},hasRedo:function(){},reset:function(){},add:function(){},addSelection:function(){},startNewGroup:function(){},addSession:function(){}},v.prototype.$overwrite=!1,v.prototype.$mode=null,v.prototype.$modeId=null,v.prototype.$scrollTop=0,v.prototype.$scrollLeft=0,v.prototype.$wrapLimit=80,v.prototype.$useWrapMode=!1,v.prototype.$wrapLimitRange={min:null,max:null},v.prototype.lineWidgets=null,v.prototype.isFullWidth=T,r.implement(v.prototype,u);var m=1,g=2,y=3,b=4,w=9,E=10,S=11,x=12;e("./edit_session/folding").Folding.call(v.prototype),e("./edit_session/bracket_match").BracketMatch.call(v.prototype),o.defineOptions(v.prototype,"session",{wrap:{set:function(e){!e||e=="off"?e=!1:e=="free"?e=!0:e=="printMargin"?e=-1:typeof e=="string"&&(e=parseInt(e,10)||!1);if(this.$wrap==e)return;this.$wrap=e;if(!e)this.setUseWrapMode(!1);else {var t=typeof e=="number"?e:null;this.setWrapLimitRange(t,t),this.setUseWrapMode(!0);}},get:function(){return this.getUseWrapMode()?this.$wrap==-1?"printMargin":this.getWrapLimitRange().min?this.$wrap:"free":"off"},handlesSet:!0},wrapMethod:{set:function(e){e=e=="auto"?this.$mode.type!="text":e!="text",e!=this.$wrapAsCode&&(this.$wrapAsCode=e,this.$useWrapMode&&(this.$useWrapMode=!1,this.setUseWrapMode(!0)));},initialValue:"auto"},indentedSoftWrap:{set:function(){this.$useWrapMode&&(this.$useWrapMode=!1,this.setUseWrapMode(!0));},initialValue:!0},firstLineNumber:{set:function(){this._signal("changeBreakpoint");},initialValue:1},useWorker:{set:function(e){this.$useWorker=e,this.$stopWorker(),e&&this.$startWorker();},initialValue:!0},useSoftTabs:{initialValue:!0},tabSize:{set:function(e){e=parseInt(e),e>0&&this.$tabSize!==e&&(this.$modified=!0,this.$rowLengthCache=[],this.$tabSize=e,this._signal("changeTabSize"));},initialValue:4,handlesSet:!0},navigateWithinSoftTabs:{initialValue:!1},foldStyle:{set:function(e){this.setFoldStyle(e);},handlesSet:!0},overwrite:{set:function(e){this._signal("changeOverwrite");},initialValue:!1},newLineMode:{set:function(e){this.doc.setNewLineMode(e);},get:function(){return this.doc.getNewLineMode()},handlesSet:!0},mode:{set:function(e){this.setMode(e);},get:function(){return this.$modeId},handlesSet:!0}}),t.EditSession=v;}),ace.define("ace/search",["require","exports","module","ace/lib/lang","ace/lib/oop","ace/range"],function(e,t,n){function u(e,t){function i(e,r){r===void 0&&(r=!0);var i=n&&t.$supportsUnicodeFlag?new RegExp("[\\p{L}\\p{N}_]","u"):new RegExp("\\w");if(i.test(e)||t.regExp)return n&&t.$supportsUnicodeFlag?r?"(?<=^|[^\\p{L}\\p{N}_])":"(?=[^\\p{L}\\p{N}_]|$)":"\\b";return ""}var n=r.supportsLookbehind(),s=Array.from(e),o=s[0],u=s[s.length-1];return i(o)+e+i(u,!1)}var r=e("./lib/lang"),i=e("./lib/oop"),s=e("./range").Range,o=function(){function e(){this.$options={};}return e.prototype.set=function(e){return i.mixin(this.$options,e),this},e.prototype.getOptions=function(){return r.copyObject(this.$options)},e.prototype.setOptions=function(e){this.$options=e;},e.prototype.find=function(e){var t=this.$options,n=this.$matchIterator(e,t);if(!n)return !1;var r=null;return n.forEach(function(e,n,i,o){return r=new s(e,n,i,o),n==o&&t.start&&t.start.start&&t.skipCurrent!=0&&r.isEqual(t.start)?(r=null,!1):!0}),r},e.prototype.findAll=function(e){var t=this.$options;if(!t.needle)return [];this.$assembleRegExp(t);var n=t.range,i=n?e.getLines(n.start.row,n.end.row):e.doc.getAllLines(),o=[],u=t.re;if(t.$isMultiLine){var a=u.length,f=i.length-a,l;e:for(var c=u.offset||0;c<=f;c++){for(var h=0;h<a;h++)if(i[c+h].search(u[h])==-1)continue e;var p=i[c],d=i[c+a-1],v=p.length-p.match(u[0])[0].length,m=d.match(u[a-1])[0].length;if(l&&l.end.row===c&&l.end.column>v)continue;o.push(l=new s(c,v,c+a-1,m)),a>2&&(c=c+a-2);}}else for(var g=0;g<i.length;g++){var y=r.getMatchOffsets(i[g],u);for(var h=0;h<y.length;h++){var b=y[h];o.push(new s(g,b.offset,g,b.offset+b.length));}}if(n){var w=n.start.column,E=n.end.column,g=0,h=o.length-1;while(g<h&&o[g].start.column<w&&o[g].start.row==0)g++;var S=n.end.row-n.start.row;while(g<h&&o[h].end.column>E&&o[h].end.row==S)h--;o=o.slice(g,h+1);for(g=0,h=o.length;g<h;g++)o[g].start.row+=n.start.row,o[g].end.row+=n.start.row;}return o},e.prototype.replace=function(e,t){var n=this.$options,r=this.$assembleRegExp(n);if(n.$isMultiLine)return t;if(!r)return;var i=r.exec(e);if(!i||i[0].length!=e.length)return null;t=e.replace(r,t);if(n.preserveCase){t=t.split("");for(var s=Math.min(e.length,e.length);s--;){var o=e[s];o&&o.toLowerCase()!=o?t[s]=t[s].toUpperCase():t[s]=t[s].toLowerCase();}t=t.join("");}return t},e.prototype.$assembleRegExp=function(e,t){if(e.needle instanceof RegExp)return e.re=e.needle;var n=e.needle;if(!e.needle)return e.re=!1;e.$supportsUnicodeFlag===undefined&&(e.$supportsUnicodeFlag=r.supportsUnicodeFlag());try{new RegExp(n,"u");}catch(i){e.$supportsUnicodeFlag=!1;}e.regExp||(n=r.escapeRegExp(n)),e.wholeWord&&(n=u(n,e));var s=e.caseSensitive?"gm":"gmi";e.$supportsUnicodeFlag&&(s+="u"),e.$isMultiLine=!t&&/[\n\r]/.test(n);if(e.$isMultiLine)return e.re=this.$assembleMultilineRegExp(n,s);try{var o=new RegExp(n,s);}catch(i){o=!1;}return e.re=o},e.prototype.$assembleMultilineRegExp=function(e,t){var n=e.replace(/\r\n|\r|\n/g,"$\n^").split("\n"),r=[];for(var i=0;i<n.length;i++)try{r.push(new RegExp(n[i],t));}catch(s){return !1}return r},e.prototype.$matchIterator=function(e,t){var n=this.$assembleRegExp(t);if(!n)return !1;var r=t.backwards==1,i=t.skipCurrent!=0,s=t.range,o=t.start;o||(o=s?s[r?"end":"start"]:e.selection.getRange()),o.start&&(o=o[i!=r?"end":"start"]);var u=s?s.start.row:0,a=s?s.end.row:e.getLength()-1;if(r)var f=function(e){var n=o.row;if(c(n,o.column,e))return;for(n--;n>=u;n--)if(c(n,Number.MAX_VALUE,e))return;if(t.wrap==0)return;for(n=a,u=o.row;n>=u;n--)if(c(n,Number.MAX_VALUE,e))return};else var f=function(e){var n=o.row;if(c(n,o.column,e))return;for(n+=1;n<=a;n++)if(c(n,0,e))return;if(t.wrap==0)return;for(n=u,a=o.row;n<=a;n++)if(c(n,0,e))return};if(t.$isMultiLine)var l=n.length,c=function(t,i,s){var o=r?t-l+1:t;if(o<0||o+l>e.getLength())return;var u=e.getLine(o),a=u.search(n[0]);if(!r&&a<i||a===-1)return;for(var f=1;f<l;f++){u=e.getLine(o+f);if(u.search(n[f])==-1)return}var c=u.match(n[l-1])[0].length;if(r&&c>i)return;if(s(o,a,o+l-1,c))return !0};else if(r)var c=function(t,r,i){var s=e.getLine(t),o=[],u,a=0;n.lastIndex=0;while(u=n.exec(s)){var f=u[0].length;a=u.index;if(!f){if(a>=s.length)break;n.lastIndex=a+=1;}if(u.index+f>r)break;o.push(u.index,f);}for(var l=o.length-1;l>=0;l-=2){var c=o[l-1],f=o[l];if(i(t,c,t,c+f))return !0}};else var c=function(t,r,i){var s=e.getLine(t),o,u;n.lastIndex=r;while(u=n.exec(s)){var a=u[0].length;o=u.index;if(i(t,o,t,o+a))return !0;if(!a){n.lastIndex=o+=1;if(o>=s.length)return !1}}};return {forEach:f}},e}();t.Search=o;}),ace.define("ace/keyboard/hash_handler",["require","exports","module","ace/lib/keys","ace/lib/useragent"],function(e,t,n){function a(e){return typeof e=="object"&&e.bindKey&&e.bindKey.position||(e.isDefault?-100:0)}var r=this&&this.__extends||function(){var e=function(t,n){return e=Object.setPrototypeOf||{__proto__:[]}instanceof Array&&function(e,t){e.__proto__=t;}||function(e,t){for(var n in t)Object.prototype.hasOwnProperty.call(t,n)&&(e[n]=t[n]);},e(t,n)};return function(t,n){function r(){this.constructor=t;}if(typeof n!="function"&&n!==null)throw new TypeError("Class extends value "+String(n)+" is not a constructor or null");e(t,n),t.prototype=n===null?Object.create(n):(r.prototype=n.prototype,new r);}}(),i=e("../lib/keys"),s=e("../lib/useragent"),o=i.KEY_MODS,u=function(){function e(e,t){this.$init(e,t,!1);}return e.prototype.$init=function(e,t,n){this.platform=t||(s.isMac?"mac":"win"),this.commands={},this.commandKeyBinding={},this.addCommands(e),this.$singleCommand=n;},e.prototype.addCommand=function(e){this.commands[e.name]&&this.removeCommand(e),this.commands[e.name]=e,e.bindKey&&this._buildKeyHash(e);},e.prototype.removeCommand=function(e,t){var n=e&&(typeof e=="string"?e:e.name);e=this.commands[n],t||delete this.commands[n];var r=this.commandKeyBinding;for(var i in r){var s=r[i];if(s==e)delete r[i];else if(Array.isArray(s)){var o=s.indexOf(e);o!=-1&&(s.splice(o,1),s.length==1&&(r[i]=s[0]));}}},e.prototype.bindKey=function(e,t,n){typeof e=="object"&&e&&(n==undefined&&(n=e.position),e=e[this.platform]);if(!e)return;if(typeof t=="function")return this.addCommand({exec:t,bindKey:e,name:t.name||e});e.split("|").forEach(function(e){var r="";if(e.indexOf(" ")!=-1){var i=e.split(/\s+/);e=i.pop(),i.forEach(function(e){var t=this.parseKeys(e),n=o[t.hashId]+t.key;r+=(r?" ":"")+n,this._addCommandToBinding(r,"chainKeys");},this),r+=" ";}var s=this.parseKeys(e),u=o[s.hashId]+s.key;this._addCommandToBinding(r+u,t,n);},this);},e.prototype._addCommandToBinding=function(e,t,n){var r=this.commandKeyBinding,i;if(!t)delete r[e];else if(!r[e]||this.$singleCommand)r[e]=t;else {Array.isArray(r[e])?(i=r[e].indexOf(t))!=-1&&r[e].splice(i,1):r[e]=[r[e]],typeof n!="number"&&(n=a(t));var s=r[e];for(i=0;i<s.length;i++){var o=s[i],u=a(o);if(u>n)break}s.splice(i,0,t);}},e.prototype.addCommands=function(e){e&&Object.keys(e).forEach(function(t){var n=e[t];if(!n)return;if(typeof n=="string")return this.bindKey(n,t);typeof n=="function"&&(n={exec:n});if(typeof n!="object")return;n.name||(n.name=t),this.addCommand(n);},this);},e.prototype.removeCommands=function(e){Object.keys(e).forEach(function(t){this.removeCommand(e[t]);},this);},e.prototype.bindKeys=function(e){Object.keys(e).forEach(function(t){this.bindKey(t,e[t]);},this);},e.prototype._buildKeyHash=function(e){this.bindKey(e.bindKey,e);},e.prototype.parseKeys=function(e){var t=e.toLowerCase().split(/[\-\+]([\-\+])?/).filter(function(e){return e}),n=t.pop(),r=i[n];if(i.FUNCTION_KEYS[r])n=i.FUNCTION_KEYS[r].toLowerCase();else {if(!t.length)return {key:n,hashId:-1};if(t.length==1&&t[0]=="shift")return {key:n.toUpperCase(),hashId:-1}}var s=0;for(var o=t.length;o--;){var u=i.KEY_MODS[t[o]];if(u==null)return typeof console!="undefined"&&console.error("invalid modifier "+t[o]+" in "+e),!1;s|=u;}return {key:n,hashId:s}},e.prototype.findKeyCommand=function(e,t){var n=o[e]+t;return this.commandKeyBinding[n]},e.prototype.handleKeyboard=function(e,t,n,r){if(r<0)return;var i=o[t]+n,s=this.commandKeyBinding[i];e.$keyChain&&(e.$keyChain+=" "+i,s=this.commandKeyBinding[e.$keyChain]||s);if(s)if(s=="chainKeys"||s[s.length-1]=="chainKeys")return e.$keyChain=e.$keyChain||i,{command:"null"};if(e.$keyChain)if(!!t&&t!=4||n.length!=1){if(t==-1||r>0)e.$keyChain="";}else e.$keyChain=e.$keyChain.slice(0,-i.length-1);return {command:s}},e.prototype.getStatusText=function(e,t){return t.$keyChain||""},e}(),f=function(e){function t(t,n){var r=e.call(this,t,n)||this;return r.$singleCommand=!0,r}return r(t,e),t}(u);f.call=function(e,t,n){u.prototype.$init.call(e,t,n,!0);},u.call=function(e,t,n){u.prototype.$init.call(e,t,n,!1);},t.HashHandler=f,t.MultiHashHandler=u;}),ace.define("ace/commands/command_manager",["require","exports","module","ace/lib/oop","ace/keyboard/hash_handler","ace/lib/event_emitter"],function(e,t,n){var r=this&&this.__extends||function(){var e=function(t,n){return e=Object.setPrototypeOf||{__proto__:[]}instanceof Array&&function(e,t){e.__proto__=t;}||function(e,t){for(var n in t)Object.prototype.hasOwnProperty.call(t,n)&&(e[n]=t[n]);},e(t,n)};return function(t,n){function r(){this.constructor=t;}if(typeof n!="function"&&n!==null)throw new TypeError("Class extends value "+String(n)+" is not a constructor or null");e(t,n),t.prototype=n===null?Object.create(n):(r.prototype=n.prototype,new r);}}(),i=e("../lib/oop"),s=e("../keyboard/hash_handler").MultiHashHandler,o=e("../lib/event_emitter").EventEmitter,u=function(e){function t(t,n){var r=e.call(this,n,t)||this;return r.byName=r.commands,r.setDefaultHandler("exec",function(e){return e.args?e.command.exec(e.editor,e.args,e.event,!1):e.command.exec(e.editor,{},e.event,!0)}),r}return r(t,e),t.prototype.exec=function(e,t,n){if(Array.isArray(e)){for(var r=e.length;r--;)if(this.exec(e[r],t,n))return !0;return !1}typeof e=="string"&&(e=this.commands[e]);if(!e)return !1;if(t&&t.$readOnly&&!e.readOnly)return !1;if(this.$checkCommandState!=0&&e.isAvailable&&!e.isAvailable(t))return !1;var i={editor:t,command:e,args:n};return i.returnValue=this._emit("exec",i),this._signal("afterExec",i),i.returnValue===!1?!1:!0},t.prototype.toggleRecording=function(e){if(this.$inReplay)return;return e&&e._emit("changeStatus"),this.recording?(this.macro.pop(),this.off("exec",this.$addCommandToMacro),this.macro.length||(this.macro=this.oldMacro),this.recording=!1):(this.$addCommandToMacro||(this.$addCommandToMacro=function(e){this.macro.push([e.command,e.args]);}.bind(this)),this.oldMacro=this.macro,this.macro=[],this.on("exec",this.$addCommandToMacro),this.recording=!0)},t.prototype.replay=function(e){if(this.$inReplay||!this.macro)return;if(this.recording)return this.toggleRecording(e);try{this.$inReplay=!0,this.macro.forEach(function(t){typeof t=="string"?this.exec(t,e):this.exec(t[0],e,t[1]);},this);}finally{this.$inReplay=!1;}},t.prototype.trimMacro=function(e){return e.map(function(e){return typeof e[0]!="string"&&(e[0]=e[0].name),e[1]||(e=e[0]),e})},t}(s);i.implement(u.prototype,o),t.CommandManager=u;}),ace.define("ace/commands/default_commands",["require","exports","module","ace/lib/lang","ace/config","ace/range"],function(e,t,n){var r=e("../lib/lang"),i=e("../config"),s=e("../range").Range;t.commands=[{name:"showSettingsMenu",description:"Show settings menu",exec:function(e){i.loadModule("ace/ext/settings_menu",function(t){t.init(e),e.showSettingsMenu();});},readOnly:!0},{name:"goToNextError",description:"Go to next error",exec:function(e){i.loadModule("ace/ext/error_marker",function(t){t.showErrorMarker(e,1);});},scrollIntoView:"animate",readOnly:!0},{name:"goToPreviousError",description:"Go to previous error",exec:function(e){i.loadModule("ace/ext/error_marker",function(t){t.showErrorMarker(e,-1);});},scrollIntoView:"animate",readOnly:!0},{name:"selectall",description:"Select all",exec:function(e){e.selectAll();},readOnly:!0},{name:"centerselection",description:"Center selection",exec:function(e){e.centerSelection();},readOnly:!0},{name:"gotoline",description:"Go to line...",exec:function(e,t){typeof t=="number"&&!isNaN(t)&&e.gotoLine(t),e.prompt({$type:"gotoLine"});},readOnly:!0},{name:"fold",exec:function(e){e.session.toggleFold(!1);},multiSelectAction:"forEach",scrollIntoView:"center",readOnly:!0},{name:"unfold",exec:function(e){e.session.toggleFold(!0);},multiSelectAction:"forEach",scrollIntoView:"center",readOnly:!0},{name:"toggleFoldWidget",description:"Toggle fold widget",exec:function(e){e.session.toggleFoldWidget();},multiSelectAction:"forEach",scrollIntoView:"center",readOnly:!0},{name:"toggleParentFoldWidget",description:"Toggle parent fold widget",exec:function(e){e.session.toggleFoldWidget(!0);},multiSelectAction:"forEach",scrollIntoView:"center",readOnly:!0},{name:"foldall",description:"Fold all",exec:function(e){e.session.foldAll();},scrollIntoView:"center",readOnly:!0},{name:"foldAllComments",description:"Fold all comments",exec:function(e){e.session.foldAllComments();},scrollIntoView:"center",readOnly:!0},{name:"foldOther",description:"Fold other",exec:function(e){e.session.foldAll(),e.session.unfold(e.selection.getAllRanges());},scrollIntoView:"center",readOnly:!0},{name:"unfoldall",description:"Unfold all",exec:function(e){e.session.unfold();},scrollIntoView:"center",readOnly:!0},{name:"findnext",description:"Find next",exec:function(e){e.findNext();},multiSelectAction:"forEach",scrollIntoView:"center",readOnly:!0},{name:"findprevious",description:"Find previous",exec:function(e){e.findPrevious();},multiSelectAction:"forEach",scrollIntoView:"center",readOnly:!0},{name:"selectOrFindNext",description:"Select or find next",exec:function(e){e.selection.isEmpty()?e.selection.selectWord():e.findNext();},readOnly:!0},{name:"selectOrFindPrevious",description:"Select or find previous",exec:function(e){e.selection.isEmpty()?e.selection.selectWord():e.findPrevious();},readOnly:!0},{name:"find",description:"Find",exec:function(e){i.loadModule("ace/ext/searchbox",function(t){t.Search(e);});},readOnly:!0},{name:"overwrite",description:"Overwrite",exec:function(e){e.toggleOverwrite();},readOnly:!0},{name:"selecttostart",description:"Select to start",exec:function(e){e.getSelection().selectFileStart();},multiSelectAction:"forEach",readOnly:!0,scrollIntoView:"animate",aceCommandGroup:"fileJump"},{name:"gotostart",description:"Go to start",exec:function(e){e.navigateFileStart();},multiSelectAction:"forEach",readOnly:!0,scrollIntoView:"animate",aceCommandGroup:"fileJump"},{name:"selectup",description:"Select up",exec:function(e){e.getSelection().selectUp();},multiSelectAction:"forEach",scrollIntoView:"cursor",readOnly:!0},{name:"golineup",description:"Go line up",exec:function(e,t){e.navigateUp(t.times);},multiSelectAction:"forEach",scrollIntoView:"cursor",readOnly:!0},{name:"selecttoend",description:"Select to end",exec:function(e){e.getSelection().selectFileEnd();},multiSelectAction:"forEach",readOnly:!0,scrollIntoView:"animate",aceCommandGroup:"fileJump"},{name:"gotoend",description:"Go to end",exec:function(e){e.navigateFileEnd();},multiSelectAction:"forEach",readOnly:!0,scrollIntoView:"animate",aceCommandGroup:"fileJump"},{name:"selectdown",description:"Select down",exec:function(e){e.getSelection().selectDown();},multiSelectAction:"forEach",scrollIntoView:"cursor",readOnly:!0},{name:"golinedown",description:"Go line down",exec:function(e,t){e.navigateDown(t.times);},multiSelectAction:"forEach",scrollIntoView:"cursor",readOnly:!0},{name:"selectwordleft",description:"Select word left",exec:function(e){e.getSelection().selectWordLeft();},multiSelectAction:"forEach",scrollIntoView:"cursor",readOnly:!0},{name:"gotowordleft",description:"Go to word left",exec:function(e){e.navigateWordLeft();},multiSelectAction:"forEach",scrollIntoView:"cursor",readOnly:!0},{name:"selecttolinestart",description:"Select to line start",exec:function(e){e.getSelection().selectLineStart();},multiSelectAction:"forEach",scrollIntoView:"cursor",readOnly:!0},{name:"gotolinestart",description:"Go to line start",exec:function(e){e.navigateLineStart();},multiSelectAction:"forEach",scrollIntoView:"cursor",readOnly:!0},{name:"selectleft",description:"Select left",exec:function(e){e.getSelection().selectLeft();},multiSelectAction:"forEach",scrollIntoView:"cursor",readOnly:!0},{name:"gotoleft",description:"Go to left",exec:function(e,t){e.navigateLeft(t.times);},multiSelectAction:"forEach",scrollIntoView:"cursor",readOnly:!0},{name:"selectwordright",description:"Select word right",exec:function(e){e.getSelection().selectWordRight();},multiSelectAction:"forEach",scrollIntoView:"cursor",readOnly:!0},{name:"gotowordright",description:"Go to word right",exec:function(e){e.navigateWordRight();},multiSelectAction:"forEach",scrollIntoView:"cursor",readOnly:!0},{name:"selecttolineend",description:"Select to line end",exec:function(e){e.getSelection().selectLineEnd();},multiSelectAction:"forEach",scrollIntoView:"cursor",readOnly:!0},{name:"gotolineend",description:"Go to line end",exec:function(e){e.navigateLineEnd();},multiSelectAction:"forEach",scrollIntoView:"cursor",readOnly:!0},{name:"selectright",description:"Select right",exec:function(e){e.getSelection().selectRight();},multiSelectAction:"forEach",scrollIntoView:"cursor",readOnly:!0},{name:"gotoright",description:"Go to right",exec:function(e,t){e.navigateRight(t.times);},multiSelectAction:"forEach",scrollIntoView:"cursor",readOnly:!0},{name:"selectpagedown",description:"Select page down",exec:function(e){e.selectPageDown();},readOnly:!0},{name:"pagedown",description:"Page down",exec:function(e){e.scrollPageDown();},readOnly:!0},{name:"gotopagedown",description:"Go to page down",exec:function(e){e.gotoPageDown();},readOnly:!0},{name:"selectpageup",description:"Select page up",exec:function(e){e.selectPageUp();},readOnly:!0},{name:"pageup",description:"Page up",exec:function(e){e.scrollPageUp();},readOnly:!0},{name:"gotopageup",description:"Go to page up",exec:function(e){e.gotoPageUp();},readOnly:!0},{name:"scrollup",description:"Scroll up",exec:function(e){e.renderer.scrollBy(0,-2*e.renderer.layerConfig.lineHeight);},readOnly:!0},{name:"scrolldown",description:"Scroll down",exec:function(e){e.renderer.scrollBy(0,2*e.renderer.layerConfig.lineHeight);},readOnly:!0},{name:"selectlinestart",description:"Select line start",exec:function(e){e.getSelection().selectLineStart();},multiSelectAction:"forEach",scrollIntoView:"cursor",readOnly:!0},{name:"selectlineend",description:"Select line end",exec:function(e){e.getSelection().selectLineEnd();},multiSelectAction:"forEach",scrollIntoView:"cursor",readOnly:!0},{name:"togglerecording",description:"Toggle recording",exec:function(e){e.commands.toggleRecording(e);},readOnly:!0},{name:"replaymacro",description:"Replay macro",exec:function(e){e.commands.replay(e);},readOnly:!0},{name:"jumptomatching",description:"Jump to matching",exec:function(e){e.jumpToMatching();},multiSelectAction:"forEach",scrollIntoView:"animate",readOnly:!0},{name:"selecttomatching",description:"Select to matching",exec:function(e){e.jumpToMatching(!0);},multiSelectAction:"forEach",scrollIntoView:"animate",readOnly:!0},{name:"expandToMatching",description:"Expand to matching",exec:function(e){e.jumpToMatching(!0,!0);},multiSelectAction:"forEach",scrollIntoView:"animate",readOnly:!0},{name:"passKeysToBrowser",description:"Pass keys to browser",exec:function(){},passEvent:!0,readOnly:!0},{name:"copy",description:"Copy",exec:function(e){},readOnly:!0},{name:"cut",description:"Cut",exec:function(e){var t=e.$copyWithEmptySelection&&e.selection.isEmpty(),n=t?e.selection.getLineRange():e.selection.getRange();e._emit("cut",n),n.isEmpty()||e.session.remove(n),e.clearSelection();},scrollIntoView:"cursor",multiSelectAction:"forEach"},{name:"paste",description:"Paste",exec:function(e,t){e.$handlePaste(t);},scrollIntoView:"cursor"},{name:"removeline",description:"Remove line",exec:function(e){e.removeLines();},scrollIntoView:"cursor",multiSelectAction:"forEachLine"},{name:"duplicateSelection",description:"Duplicate selection",exec:function(e){e.duplicateSelection();},scrollIntoView:"cursor",multiSelectAction:"forEach"},{name:"sortlines",description:"Sort lines",exec:function(e){e.sortLines();},scrollIntoView:"selection",multiSelectAction:"forEachLine"},{name:"togglecomment",description:"Toggle comment",exec:function(e){e.toggleCommentLines();},multiSelectAction:"forEachLine",scrollIntoView:"selectionPart"},{name:"toggleBlockComment",description:"Toggle block comment",exec:function(e){e.toggleBlockComment();},multiSelectAction:"forEach",scrollIntoView:"selectionPart"},{name:"modifyNumberUp",description:"Modify number up",exec:function(e){e.modifyNumber(1);},scrollIntoView:"cursor",multiSelectAction:"forEach"},{name:"modifyNumberDown",description:"Modify number down",exec:function(e){e.modifyNumber(-1);},scrollIntoView:"cursor",multiSelectAction:"forEach"},{name:"replace",description:"Replace",exec:function(e){i.loadModule("ace/ext/searchbox",function(t){t.Search(e,!0);});}},{name:"undo",description:"Undo",exec:function(e){e.undo();}},{name:"redo",description:"Redo",exec:function(e){e.redo();}},{name:"copylinesup",description:"Copy lines up",exec:function(e){e.copyLinesUp();},scrollIntoView:"cursor"},{name:"movelinesup",description:"Move lines up",exec:function(e){e.moveLinesUp();},scrollIntoView:"cursor"},{name:"copylinesdown",description:"Copy lines down",exec:function(e){e.copyLinesDown();},scrollIntoView:"cursor"},{name:"movelinesdown",description:"Move lines down",exec:function(e){e.moveLinesDown();},scrollIntoView:"cursor"},{name:"del",description:"Delete",exec:function(e){e.remove("right");},multiSelectAction:"forEach",scrollIntoView:"cursor"},{name:"backspace",description:"Backspace",exec:function(e){e.remove("left");},multiSelectAction:"forEach",scrollIntoView:"cursor"},{name:"cut_or_delete",description:"Cut or delete",exec:function(e){if(!e.selection.isEmpty())return !1;e.remove("left");},multiSelectAction:"forEach",scrollIntoView:"cursor"},{name:"removetolinestart",description:"Remove to line start",exec:function(e){e.removeToLineStart();},multiSelectAction:"forEach",scrollIntoView:"cursor"},{name:"removetolineend",description:"Remove to line end",exec:function(e){e.removeToLineEnd();},multiSelectAction:"forEach",scrollIntoView:"cursor"},{name:"removetolinestarthard",description:"Remove to line start hard",exec:function(e){var t=e.selection.getRange();t.start.column=0,e.session.remove(t);},multiSelectAction:"forEach",scrollIntoView:"cursor"},{name:"removetolineendhard",description:"Remove to line end hard",exec:function(e){var t=e.selection.getRange();t.end.column=Number.MAX_VALUE,e.session.remove(t);},multiSelectAction:"forEach",scrollIntoView:"cursor"},{name:"removewordleft",description:"Remove word left",exec:function(e){e.removeWordLeft();},multiSelectAction:"forEach",scrollIntoView:"cursor"},{name:"removewordright",description:"Remove word right",exec:function(e){e.removeWordRight();},multiSelectAction:"forEach",scrollIntoView:"cursor"},{name:"outdent",description:"Outdent",exec:function(e){e.blockOutdent();},multiSelectAction:"forEach",scrollIntoView:"selectionPart"},{name:"indent",description:"Indent",exec:function(e){e.indent();},multiSelectAction:"forEach",scrollIntoView:"selectionPart"},{name:"blockoutdent",description:"Block outdent",exec:function(e){e.blockOutdent();},multiSelectAction:"forEachLine",scrollIntoView:"selectionPart"},{name:"blockindent",description:"Block indent",exec:function(e){e.blockIndent();},multiSelectAction:"forEachLine",scrollIntoView:"selectionPart"},{name:"insertstring",description:"Insert string",exec:function(e,t){e.insert(t);},multiSelectAction:"forEach",scrollIntoView:"cursor"},{name:"inserttext",description:"Insert text",exec:function(e,t){e.insert(r.stringRepeat(t.text||"",t.times||1));},multiSelectAction:"forEach",scrollIntoView:"cursor"},{name:"splitline",description:"Split line",exec:function(e){e.splitLine();},multiSelectAction:"forEach",scrollIntoView:"cursor"},{name:"transposeletters",description:"Transpose letters",exec:function(e){e.transposeLetters();},multiSelectAction:function(e){e.transposeSelections(1);},scrollIntoView:"cursor"},{name:"touppercase",description:"To uppercase",exec:function(e){e.toUpperCase();},multiSelectAction:"forEach",scrollIntoView:"cursor"},{name:"tolowercase",description:"To lowercase",exec:function(e){e.toLowerCase();},multiSelectAction:"forEach",scrollIntoView:"cursor"},{name:"autoindent",description:"Auto Indent",exec:function(e){e.autoIndent();},multiSelectAction:"forEachLine",scrollIntoView:"animate"},{name:"expandtoline",description:"Expand to line",exec:function(e){var t=e.selection.getRange();t.start.column=t.end.column=0,t.end.row++,e.selection.setRange(t,!1);},multiSelectAction:"forEach",scrollIntoView:"cursor",readOnly:!0},{name:"openlink",exec:function(e){e.openLink();}},{name:"joinlines",description:"Join lines",exec:function(e){var t=e.selection.isBackwards(),n=t?e.selection.getSelectionLead():e.selection.getSelectionAnchor(),i=t?e.selection.getSelectionAnchor():e.selection.getSelectionLead(),o=e.session.doc.getLine(n.row).length,u=e.session.doc.getTextRange(e.selection.getRange()),a=u.replace(/\n\s*/," ").length,f=e.session.doc.getLine(n.row);for(var l=n.row+1;l<=i.row+1;l++){var c=r.stringTrimLeft(r.stringTrimRight(e.session.doc.getLine(l)));c.length!==0&&(c=" "+c),f+=c;}i.row+1<e.session.doc.getLength()-1&&(f+=e.session.doc.getNewLineCharacter()),e.clearSelection(),e.session.doc.replace(new s(n.row,0,i.row+2,0),f),a>0?(e.selection.moveCursorTo(n.row,n.column),e.selection.selectTo(n.row,n.column+a)):(o=e.session.doc.getLine(n.row).length>o?o+1:o,e.selection.moveCursorTo(n.row,o));},multiSelectAction:"forEach",readOnly:!0},{name:"invertSelection",description:"Invert selection",exec:function(e){var t=e.session.doc.getLength()-1,n=e.session.doc.getLine(t).length,r=e.selection.rangeList.ranges,i=[];r.length<1&&(r=[e.selection.getRange()]);for(var o=0;o<r.length;o++)o==r.length-1&&(r[o].end.row!==t||r[o].end.column!==n)&&i.push(new s(r[o].end.row,r[o].end.column,t,n)),o===0?(r[o].start.row!==0||r[o].start.column!==0)&&i.push(new s(0,0,r[o].start.row,r[o].start.column)):i.push(new s(r[o-1].end.row,r[o-1].end.column,r[o].start.row,r[o].start.column));e.exitMultiSelectMode(),e.clearSelection();for(var o=0;o<i.length;o++)e.selection.addRange(i[o],!1);},readOnly:!0,scrollIntoView:"none"},{name:"addLineAfter",description:"Add new line after the current line",exec:function(e){e.selection.clearSelection(),e.navigateLineEnd(),e.insert("\n");},multiSelectAction:"forEach",scrollIntoView:"cursor"},{name:"addLineBefore",description:"Add new line before the current line",exec:function(e){e.selection.clearSelection();var t=e.getCursorPosition();e.selection.moveTo(t.row-1,Number.MAX_VALUE),e.insert("\n"),t.row===0&&e.navigateUp();},multiSelectAction:"forEach",scrollIntoView:"cursor"},{name:"openCommandPallete",description:"Open command palette",exec:function(e){e.prompt({$type:"commands"});},readOnly:!0},{name:"modeSelect",description:"Change language mode...",exec:function(e){e.prompt({$type:"modes"});},readOnly:!0}];for(var o=1;o<9;o++)t.commands.push({name:"foldToLevel"+o,description:"Fold To Level "+o,level:o,exec:function(e){e.session.foldToLevel(this.level);},scrollIntoView:"center",readOnly:!0});}),ace.define("ace/line_widgets",["require","exports","module","ace/lib/dom"],function(e,t,n){var r=e("./lib/dom"),i=function(){function e(e){this.session=e,this.session.widgetManager=this,this.session.getRowLength=this.getRowLength,this.session.$getWidgetScreenLength=this.$getWidgetScreenLength,this.updateOnChange=this.updateOnChange.bind(this),this.renderWidgets=this.renderWidgets.bind(this),this.measureWidgets=this.measureWidgets.bind(this),this.session._changedWidgets=[],this.$onChangeEditor=this.$onChangeEditor.bind(this),this.session.on("change",this.updateOnChange),this.session.on("changeFold",this.updateOnFold),this.session.on("changeEditor",this.$onChangeEditor);}return e.prototype.getRowLength=function(e){var t;return this.lineWidgets?t=this.lineWidgets[e]&&this.lineWidgets[e].rowCount||0:t=0,!this.$useWrapMode||!this.$wrapData[e]?1+t:this.$wrapData[e].length+1+t},e.prototype.$getWidgetScreenLength=function(){var e=0;return this.lineWidgets.forEach(function(t){t&&t.rowCount&&!t.hidden&&(e+=t.rowCount);}),e},e.prototype.$onChangeEditor=function(e){this.attach(e.editor);},e.prototype.attach=function(e){e&&e.widgetManager&&e.widgetManager!=this&&e.widgetManager.detach();if(this.editor==e)return;this.detach(),this.editor=e,e&&(e.widgetManager=this,e.renderer.on("beforeRender",this.measureWidgets),e.renderer.on("afterRender",this.renderWidgets));},e.prototype.detach=function(e){var t=this.editor;if(!t)return;this.editor=null,t.widgetManager=null,t.renderer.off("beforeRender",this.measureWidgets),t.renderer.off("afterRender",this.renderWidgets);var n=this.session.lineWidgets;n&&n.forEach(function(e){e&&e.el&&e.el.parentNode&&(e._inDocument=!1,e.el.parentNode.removeChild(e.el));});},e.prototype.updateOnFold=function(e,t){var n=t.lineWidgets;if(!n||!e.action)return;var r=e.data,i=r.start.row,s=r.end.row,o=e.action=="add";for(var u=i+1;u<s;u++)n[u]&&(n[u].hidden=o);n[s]&&(o?n[i]?n[s].hidden=o:n[i]=n[s]:(n[i]==n[s]&&(n[i]=undefined),n[s].hidden=o));},e.prototype.updateOnChange=function(e){var t=this.session.lineWidgets;if(!t)return;var n=e.start.row,r=e.end.row-n;if(r!==0)if(e.action=="remove"){var i=t.splice(n+1,r);!t[n]&&i[i.length-1]&&(t[n]=i.pop()),i.forEach(function(e){e&&this.removeLineWidget(e);},this),this.$updateRows();}else {var s=new Array(r);t[n]&&t[n].column!=null&&e.start.column>t[n].column&&n++,s.unshift(n,0),t.splice.apply(t,s),this.$updateRows();}},e.prototype.$updateRows=function(){var e=this.session.lineWidgets;if(!e)return;var t=!0;e.forEach(function(e,n){if(e){t=!1,e.row=n;while(e.$oldWidget)e.$oldWidget.row=n,e=e.$oldWidget;}}),t&&(this.session.lineWidgets=null);},e.prototype.$registerLineWidget=function(e){this.session.lineWidgets||(this.session.lineWidgets=new Array(this.session.getLength()));var t=this.session.lineWidgets[e.row];return t&&(e.$oldWidget=t,t.el&&t.el.parentNode&&(t.el.parentNode.removeChild(t.el),t._inDocument=!1)),this.session.lineWidgets[e.row]=e,e},e.prototype.addLineWidget=function(e){this.$registerLineWidget(e),e.session=this.session;if(!this.editor)return e;var t=this.editor.renderer;e.html&&!e.el&&(e.el=r.createElement("div"),e.el.innerHTML=e.html),e.text&&!e.el&&(e.el=r.createElement("div"),e.el.textContent=e.text),e.el&&(r.addCssClass(e.el,"ace_lineWidgetContainer"),e.className&&r.addCssClass(e.el,e.className),e.el.style.position="absolute",e.el.style.zIndex=5,t.container.appendChild(e.el),e._inDocument=!0,e.coverGutter||(e.el.style.zIndex=3),e.pixelHeight==null&&(e.pixelHeight=e.el.offsetHeight)),e.rowCount==null&&(e.rowCount=e.pixelHeight/t.layerConfig.lineHeight);var n=this.session.getFoldAt(e.row,0);e.$fold=n;if(n){var i=this.session.lineWidgets;e.row==n.end.row&&!i[n.start.row]?i[n.start.row]=e:e.hidden=!0;}return this.session._emit("changeFold",{data:{start:{row:e.row}}}),this.$updateRows(),this.renderWidgets(null,t),this.onWidgetChanged(e),e},e.prototype.removeLineWidget=function(e){e._inDocument=!1,e.session=null,e.el&&e.el.parentNode&&e.el.parentNode.removeChild(e.el);if(e.editor&&e.editor.destroy)try{e.editor.destroy();}catch(t){}if(this.session.lineWidgets){var n=this.session.lineWidgets[e.row];if(n==e)this.session.lineWidgets[e.row]=e.$oldWidget,e.$oldWidget&&this.onWidgetChanged(e.$oldWidget);else while(n){if(n.$oldWidget==e){n.$oldWidget=e.$oldWidget;break}n=n.$oldWidget;}}this.session._emit("changeFold",{data:{start:{row:e.row}}}),this.$updateRows();},e.prototype.getWidgetsAtRow=function(e){var t=this.session.lineWidgets,n=t&&t[e],r=[];while(n)r.push(n),n=n.$oldWidget;return r},e.prototype.onWidgetChanged=function(e){this.session._changedWidgets.push(e),this.editor&&this.editor.renderer.updateFull();},e.prototype.measureWidgets=function(e,t){var n=this.session._changedWidgets,r=t.layerConfig;if(!n||!n.length)return;var i=Infinity;for(var s=0;s<n.length;s++){var o=n[s];if(!o||!o.el)continue;if(o.session!=this.session)continue;if(!o._inDocument){if(this.session.lineWidgets[o.row]!=o)continue;o._inDocument=!0,t.container.appendChild(o.el);}o.h=o.el.offsetHeight,o.fixedWidth||(o.w=o.el.offsetWidth,o.screenWidth=Math.ceil(o.w/r.characterWidth));var u=o.h/r.lineHeight;o.coverLine&&(u-=this.session.getRowLineCount(o.row),u<0&&(u=0)),o.rowCount!=u&&(o.rowCount=u,o.row<i&&(i=o.row));}i!=Infinity&&(this.session._emit("changeFold",{data:{start:{row:i}}}),this.session.lineWidgetWidth=null),this.session._changedWidgets=[];},e.prototype.renderWidgets=function(e,t){var n=t.layerConfig,r=this.session.lineWidgets;if(!r)return;var i=Math.min(this.firstRow,n.firstRow),s=Math.max(this.lastRow,n.lastRow,r.length);while(i>0&&!r[i])i--;this.firstRow=n.firstRow,this.lastRow=n.lastRow,t.$cursorLayer.config=n;for(var o=i;o<=s;o++){var u=r[o];if(!u||!u.el)continue;if(u.hidden){u.el.style.top=-100-(u.pixelHeight||0)+"px";continue}u._inDocument||(u._inDocument=!0,t.container.appendChild(u.el));var a=t.$cursorLayer.getPixelPosition({row:o,column:0},!0).top;u.coverLine||(a+=n.lineHeight*this.session.getRowLineCount(u.row)),u.el.style.top=a-n.offset+"px";var f=u.coverGutter?0:t.gutterWidth;u.fixedWidth||(f-=t.scrollLeft),u.el.style.left=f+"px",u.fullWidth&&u.screenWidth&&(u.el.style.minWidth=n.width+2*n.padding+"px"),u.fixedWidth?u.el.style.right=t.scrollBar.getWidth()+"px":u.el.style.right="";}},e}();t.LineWidgets=i;}),ace.define("ace/keyboard/gutter_handler",["require","exports","module","ace/lib/keys","ace/mouse/default_gutter_handler"],function(e,t,n){var r=e("../lib/keys"),i=e("../mouse/default_gutter_handler").GutterTooltip,s=function(){function e(e){this.editor=e,this.gutterLayer=e.renderer.$gutterLayer,this.element=e.renderer.$gutter,this.lines=e.renderer.$gutterLayer.$lines,this.activeRowIndex=null,this.activeLane=null,this.annotationTooltip=new i(this.editor);}return e.prototype.addListener=function(){this.element.addEventListener("keydown",this.$onGutterKeyDown.bind(this)),this.element.addEventListener("focusout",this.$blurGutter.bind(this)),this.editor.on("mousewheel",this.$blurGutter.bind(this));},e.prototype.removeListener=function(){this.element.removeEventListener("keydown",this.$onGutterKeyDown.bind(this)),this.element.removeEventListener("focusout",this.$blurGutter.bind(this)),this.editor.off("mousewheel",this.$blurGutter.bind(this));},e.prototype.$onGutterKeyDown=function(e){if(this.annotationTooltip.isOpen){e.preventDefault(),e.keyCode===r.escape&&this.annotationTooltip.hideTooltip();return}if(e.target===this.element){if(e.keyCode!=r["enter"])return;e.preventDefault();var t=this.editor.getCursorPosition().row;this.editor.isRowVisible(t)||this.editor.scrollToLine(t,!0,!0),setTimeout(function(){var e=this.$rowToRowIndex(this.gutterLayer.$cursorCell.row),t=this.$findNearestFoldWidget(e),n=this.$findNearestAnnotation(e);if(t===null&&n===null)return;if(t===null&&n!==null){this.activeRowIndex=n,this.activeLane="annotation",this.$focusAnnotation(this.activeRowIndex);return}if(t!==null&&n===null){this.activeRowIndex=t,this.activeLane="fold",this.$focusFoldWidget(this.activeRowIndex);return}if(Math.abs(n-e)<Math.abs(t-e)){this.activeRowIndex=n,this.activeLane="annotation",this.$focusAnnotation(this.activeRowIndex);return}this.activeRowIndex=t,this.activeLane="fold",this.$focusFoldWidget(this.activeRowIndex);return}.bind(this),10);return}this.$handleGutterKeyboardInteraction(e),setTimeout(function(){this.editor._signal("gutterkeydown",new o(e,this));}.bind(this),10);},e.prototype.$handleGutterKeyboardInteraction=function(e){if(e.keyCode===r.tab){e.preventDefault();return}if(e.keyCode===r.escape){e.preventDefault(),this.$blurGutter(),this.element.focus(),this.lane=null;return}if(e.keyCode===r.up){e.preventDefault();switch(this.activeLane){case"fold":this.$moveFoldWidgetUp();break;case"annotation":this.$moveAnnotationUp();}return}if(e.keyCode===r.down){e.preventDefault();switch(this.activeLane){case"fold":this.$moveFoldWidgetDown();break;case"annotation":this.$moveAnnotationDown();}return}if(e.keyCode===r.left){e.preventDefault(),this.$switchLane("annotation");return}if(e.keyCode===r.right){e.preventDefault(),this.$switchLane("fold");return}if(e.keyCode===r.enter||e.keyCode===r.space){e.preventDefault();switch(this.activeLane){case"fold":if(this.gutterLayer.session.foldWidgets[this.$rowIndexToRow(this.activeRowIndex)]==="start"){var t=this.$rowIndexToRow(this.activeRowIndex);this.editor.session.onFoldWidgetClick(this.$rowIndexToRow(this.activeRowIndex),e),setTimeout(function(){this.$rowIndexToRow(this.activeRowIndex)!==t&&(this.$blurFoldWidget(this.activeRowIndex),this.activeRowIndex=this.$rowToRowIndex(t),this.$focusFoldWidget(this.activeRowIndex));}.bind(this),10);break}if(this.gutterLayer.session.foldWidgets[this.$rowIndexToRow(this.activeRowIndex)]==="end")break;return;case"annotation":var n=this.lines.cells[this.activeRowIndex].element.childNodes[2],i=n.getBoundingClientRect(),s=this.annotationTooltip.getElement().style;s.left=i.right+"px",s.top=i.bottom+"px",this.annotationTooltip.showTooltip(this.$rowIndexToRow(this.activeRowIndex));}return}},e.prototype.$blurGutter=function(){if(this.activeRowIndex!==null)switch(this.activeLane){case"fold":this.$blurFoldWidget(this.activeRowIndex);break;case"annotation":this.$blurAnnotation(this.activeRowIndex);}this.annotationTooltip.isOpen&&this.annotationTooltip.hideTooltip();return},e.prototype.$isFoldWidgetVisible=function(e){var t=this.editor.isRowFullyVisible(this.$rowIndexToRow(e)),n=this.$getFoldWidget(e).style.display!=="none";return t&&n},e.prototype.$isAnnotationVisible=function(e){var t=this.editor.isRowFullyVisible(this.$rowIndexToRow(e)),n=this.$getAnnotation(e).style.display!=="none";return t&&n},e.prototype.$getFoldWidget=function(e){var t=this.lines.get(e),n=t.element;return n.childNodes[1]},e.prototype.$getAnnotation=function(e){var t=this.lines.get(e),n=t.element;return n.childNodes[2]},e.prototype.$findNearestFoldWidget=function(e){if(this.$isFoldWidgetVisible(e))return e;var t=0;while(e-t>0||e+t<this.lines.getLength()-1){t++;if(e-t>=0&&this.$isFoldWidgetVisible(e-t))return e-t;if(e+t<=this.lines.getLength()-1&&this.$isFoldWidgetVisible(e+t))return e+t}return null},e.prototype.$findNearestAnnotation=function(e){if(this.$isAnnotationVisible(e))return e;var t=0;while(e-t>0||e+t<this.lines.getLength()-1){t++;if(e-t>=0&&this.$isAnnotationVisible(e-t))return e-t;if(e+t<=this.lines.getLength()-1&&this.$isAnnotationVisible(e+t))return e+t}return null},e.prototype.$focusFoldWidget=function(e){if(e==null)return;var t=this.$getFoldWidget(e);t.classList.add(this.editor.renderer.keyboardFocusClassName),t.focus();},e.prototype.$focusAnnotation=function(e){if(e==null)return;var t=this.$getAnnotation(e);t.classList.add(this.editor.renderer.keyboardFocusClassName),t.focus();},e.prototype.$blurFoldWidget=function(e){var t=this.$getFoldWidget(e);t.classList.remove(this.editor.renderer.keyboardFocusClassName),t.blur();},e.prototype.$blurAnnotation=function(e){var t=this.$getAnnotation(e);t.classList.remove(this.editor.renderer.keyboardFocusClassName),t.blur();},e.prototype.$moveFoldWidgetUp=function(){var e=this.activeRowIndex;while(e>0){e--;if(this.$isFoldWidgetVisible(e)){this.$blurFoldWidget(this.activeRowIndex),this.activeRowIndex=e,this.$focusFoldWidget(this.activeRowIndex);return}}return},e.prototype.$moveFoldWidgetDown=function(){var e=this.activeRowIndex;while(e<this.lines.getLength()-1){e++;if(this.$isFoldWidgetVisible(e)){this.$blurFoldWidget(this.activeRowIndex),this.activeRowIndex=e,this.$focusFoldWidget(this.activeRowIndex);return}}return},e.prototype.$moveAnnotationUp=function(){var e=this.activeRowIndex;while(e>0){e--;if(this.$isAnnotationVisible(e)){this.$blurAnnotation(this.activeRowIndex),this.activeRowIndex=e,this.$focusAnnotation(this.activeRowIndex);return}}return},e.prototype.$moveAnnotationDown=function(){var e=this.activeRowIndex;while(e<this.lines.getLength()-1){e++;if(this.$isAnnotationVisible(e)){this.$blurAnnotation(this.activeRowIndex),this.activeRowIndex=e,this.$focusAnnotation(this.activeRowIndex);return}}return},e.prototype.$switchLane=function(e){switch(e){case"annotation":if(this.activeLane==="annotation")break;var t=this.$findNearestAnnotation(this.activeRowIndex);if(t==null)break;this.activeLane="annotation",this.$blurFoldWidget(this.activeRowIndex),this.activeRowIndex=t,this.$focusAnnotation(this.activeRowIndex);break;case"fold":if(this.activeLane==="fold")break;var n=this.$findNearestFoldWidget(this.activeRowIndex);if(n==null)break;this.activeLane="fold",this.$blurAnnotation(this.activeRowIndex),this.activeRowIndex=n,this.$focusFoldWidget(this.activeRowIndex);}return},e.prototype.$rowIndexToRow=function(e){var t=this.lines.get(e);return t?t.row:null},e.prototype.$rowToRowIndex=function(e){for(var t=0;t<this.lines.getLength();t++){var n=this.lines.get(t);if(n.row==e)return t}return null},e}();t.GutterKeyboardHandler=s;var o=function(){function e(e,t){this.gutterKeyboardHandler=t,this.domEvent=e;}return e.prototype.getKey=function(){return r.keyCodeToString(this.domEvent.keyCode)},e.prototype.getRow=function(){return this.gutterKeyboardHandler.$rowIndexToRow(this.gutterKeyboardHandler.activeRowIndex)},e.prototype.isInAnnotationLane=function(){return this.gutterKeyboardHandler.activeLane==="annotation"},e.prototype.isInFoldLane=function(){return this.gutterKeyboardHandler.activeLane==="fold"},e}();t.GutterKeyboardEvent=o;}),ace.define("ace/editor",["require","exports","module","ace/lib/oop","ace/lib/dom","ace/lib/lang","ace/lib/useragent","ace/keyboard/textinput","ace/mouse/mouse_handler","ace/mouse/fold_handler","ace/keyboard/keybinding","ace/edit_session","ace/search","ace/range","ace/lib/event_emitter","ace/commands/command_manager","ace/commands/default_commands","ace/config","ace/token_iterator","ace/line_widgets","ace/keyboard/gutter_handler","ace/config","ace/clipboard","ace/lib/keys"],function(e,t,n){var r=this&&this.__values||function(e){var t=typeof Symbol=="function"&&Symbol.iterator,n=t&&e[t],r=0;if(n)return n.call(e);if(e&&typeof e.length=="number")return {next:function(){return e&&r>=e.length&&(e=void 0),{value:e&&e[r++],done:!e}}};throw new TypeError(t?"Object is not iterable.":"Symbol.iterator is not defined.")},i=e("./lib/oop"),s=e("./lib/dom"),o=e("./lib/lang"),u=e("./lib/useragent"),a=e("./keyboard/textinput").TextInput,f=e("./mouse/mouse_handler").MouseHandler,l=e("./mouse/fold_handler").FoldHandler,c=e("./keyboard/keybinding").KeyBinding,h=e("./edit_session").EditSession,p=e("./search").Search,d=e("./range").Range,v=e("./lib/event_emitter").EventEmitter,m=e("./commands/command_manager").CommandManager,g=e("./commands/default_commands").commands,y=e("./config"),b=e("./token_iterator").TokenIterator,w=e("./line_widgets").LineWidgets,E=e("./keyboard/gutter_handler").GutterKeyboardHandler,S=e("./config").nls,x=e("./clipboard"),T=e("./lib/keys"),N=function(){function e(t,n,r){this.$toDestroy=[];var i=t.getContainerElement();this.container=i,this.renderer=t,this.id="editor"+ ++e.$uid,this.commands=new m(u.isMac?"mac":"win",g),typeof document=="object"&&(this.textInput=new a(t.getTextAreaContainer(),this),this.renderer.textarea=this.textInput.getElement(),this.$mouseHandler=new f(this),new l(this)),this.keyBinding=new c(this),this.$search=(new p).set({wrap:!0}),this.$historyTracker=this.$historyTracker.bind(this),this.commands.on("exec",this.$historyTracker),this.$initOperationListeners(),this._$emitInputEvent=o.delayedCall(function(){this._signal("input",{}),this.session&&!this.session.destroyed&&this.session.bgTokenizer.scheduleStart();}.bind(this)),this.on("change",function(e,t){t._$emitInputEvent.schedule(31);}),this.setSession(n||r&&r.session||new h("")),y.resetOptions(this),r&&this.setOptions(r),y._signal("editor",this);}return e.prototype.$initOperationListeners=function(){this.commands.on("exec",this.startOperation.bind(this),!0),this.commands.on("afterExec",this.endOperation.bind(this),!0),this.$opResetTimer=o.delayedCall(this.endOperation.bind(this,!0)),this.on("change",function(){this.curOp||(this.startOperation(),this.curOp.selectionBefore=this.$lastSel),this.curOp.docChanged=!0;}.bind(this),!0),this.on("changeSelection",function(){this.curOp||(this.startOperation(),this.curOp.selectionBefore=this.$lastSel),this.curOp.selectionChanged=!0;}.bind(this),!0);},e.prototype.startOperation=function(e){if(this.curOp){if(!e||this.curOp.command)return;this.prevOp=this.curOp;}e||(this.previousCommand=null,e={}),this.$opResetTimer.schedule(),this.curOp=this.session.curOp={command:e.command||{},args:e.args,scrollTop:this.renderer.scrollTop},this.curOp.selectionBefore=this.selection.toJSON();},e.prototype.endOperation=function(e){if(this.curOp&&this.session){if(e&&e.returnValue===!1||!this.session)return this.curOp=null;if(e==1&&this.curOp.command&&this.curOp.command.name=="mouse")return;this._signal("beforeEndOperation");if(!this.curOp)return;var t=this.curOp.command,n=t&&t.scrollIntoView;if(n){switch(n){case"center-animate":n="animate";case"center":this.renderer.scrollCursorIntoView(null,.5);break;case"animate":case"cursor":this.renderer.scrollCursorIntoView();break;case"selectionPart":var r=this.selection.getRange(),i=this.renderer.layerConfig;(r.start.row>=i.lastRow||r.end.row<=i.firstRow)&&this.renderer.scrollSelectionIntoView(this.selection.anchor,this.selection.lead);break;}n=="animate"&&this.renderer.animateScrolling(this.curOp.scrollTop);}var s=this.selection.toJSON();this.curOp.selectionAfter=s,this.$lastSel=this.selection.toJSON(),this.session.getUndoManager().addSelection(s),this.prevOp=this.curOp,this.curOp=null;}},e.prototype.$historyTracker=function(e){if(!this.$mergeUndoDeltas)return;var t=this.prevOp,n=this.$mergeableCommands,r=t.command&&e.command.name==t.command.name;if(e.command.name=="insertstring"){var i=e.args;this.mergeNextCommand===undefined&&(this.mergeNextCommand=!0),r=r&&this.mergeNextCommand&&(!/\s/.test(i)||/\s/.test(t.args)),this.mergeNextCommand=!0;}else r=r&&n.indexOf(e.command.name)!==-1;this.$mergeUndoDeltas!="always"&&Date.now()-this.sequenceStartTime>2e3&&(r=!1),r?this.session.mergeUndoDeltas=!0:n.indexOf(e.command.name)!==-1&&(this.sequenceStartTime=Date.now());},e.prototype.setKeyboardHandler=function(e,t){if(e&&typeof e=="string"&&e!="ace"){this.$keybindingId=e;var n=this;y.loadModule(["keybinding",e],function(r){n.$keybindingId==e&&n.keyBinding.setKeyboardHandler(r&&r.handler),t&&t();});}else this.$keybindingId=null,this.keyBinding.setKeyboardHandler(e),t&&t();},e.prototype.getKeyboardHandler=function(){return this.keyBinding.getKeyboardHandler()},e.prototype.setSession=function(e){if(this.session==e)return;this.curOp&&this.endOperation(),this.curOp={};var t=this.session;if(t){this.session.off("change",this.$onDocumentChange),this.session.off("changeMode",this.$onChangeMode),this.session.off("tokenizerUpdate",this.$onTokenizerUpdate),this.session.off("changeTabSize",this.$onChangeTabSize),this.session.off("changeWrapLimit",this.$onChangeWrapLimit),this.session.off("changeWrapMode",this.$onChangeWrapMode),this.session.off("changeFold",this.$onChangeFold),this.session.off("changeFrontMarker",this.$onChangeFrontMarker),this.session.off("changeBackMarker",this.$onChangeBackMarker),this.session.off("changeBreakpoint",this.$onChangeBreakpoint),this.session.off("changeAnnotation",this.$onChangeAnnotation),this.session.off("changeOverwrite",this.$onCursorChange),this.session.off("changeScrollTop",this.$onScrollTopChange),this.session.off("changeScrollLeft",this.$onScrollLeftChange);var n=this.session.getSelection();n.off("changeCursor",this.$onCursorChange),n.off("changeSelection",this.$onSelectionChange);}this.session=e,e?(this.$onDocumentChange=this.onDocumentChange.bind(this),e.on("change",this.$onDocumentChange),this.renderer.setSession(e),this.$onChangeMode=this.onChangeMode.bind(this),e.on("changeMode",this.$onChangeMode),this.$onTokenizerUpdate=this.onTokenizerUpdate.bind(this),e.on("tokenizerUpdate",this.$onTokenizerUpdate),this.$onChangeTabSize=this.renderer.onChangeTabSize.bind(this.renderer),e.on("changeTabSize",this.$onChangeTabSize),this.$onChangeWrapLimit=this.onChangeWrapLimit.bind(this),e.on("changeWrapLimit",this.$onChangeWrapLimit),this.$onChangeWrapMode=this.onChangeWrapMode.bind(this),e.on("changeWrapMode",this.$onChangeWrapMode),this.$onChangeFold=this.onChangeFold.bind(this),e.on("changeFold",this.$onChangeFold),this.$onChangeFrontMarker=this.onChangeFrontMarker.bind(this),this.session.on("changeFrontMarker",this.$onChangeFrontMarker),this.$onChangeBackMarker=this.onChangeBackMarker.bind(this),this.session.on("changeBackMarker",this.$onChangeBackMarker),this.$onChangeBreakpoint=this.onChangeBreakpoint.bind(this),this.session.on("changeBreakpoint",this.$onChangeBreakpoint),this.$onChangeAnnotation=this.onChangeAnnotation.bind(this),this.session.on("changeAnnotation",this.$onChangeAnnotation),this.$onCursorChange=this.onCursorChange.bind(this),this.session.on("changeOverwrite",this.$onCursorChange),this.$onScrollTopChange=this.onScrollTopChange.bind(this),this.session.on("changeScrollTop",this.$onScrollTopChange),this.$onScrollLeftChange=this.onScrollLeftChange.bind(this),this.session.on("changeScrollLeft",this.$onScrollLeftChange),this.selection=e.getSelection(),this.selection.on("changeCursor",this.$onCursorChange),this.$onSelectionChange=this.onSelectionChange.bind(this),this.selection.on("changeSelection",this.$onSelectionChange),this.onChangeMode(),this.onCursorChange(),this.onScrollTopChange(),this.onScrollLeftChange(),this.onSelectionChange(),this.onChangeFrontMarker(),this.onChangeBackMarker(),this.onChangeBreakpoint(),this.onChangeAnnotation(),this.session.getUseWrapMode()&&this.renderer.adjustWrapLimit(),this.renderer.updateFull()):(this.selection=null,this.renderer.setSession(e)),this._signal("changeSession",{session:e,oldSession:t}),this.curOp=null,t&&t._signal("changeEditor",{oldEditor:this}),e&&e._signal("changeEditor",{editor:this}),e&&!e.destroyed&&e.bgTokenizer.scheduleStart();},e.prototype.getSession=function(){return this.session},e.prototype.setValue=function(e,t){return this.session.doc.setValue(e),t?t==1?this.navigateFileEnd():t==-1&&this.navigateFileStart():this.selectAll(),e},e.prototype.getValue=function(){return this.session.getValue()},e.prototype.getSelection=function(){return this.selection},e.prototype.resize=function(e){this.renderer.onResize(e);},e.prototype.setTheme=function(e,t){this.renderer.setTheme(e,t);},e.prototype.getTheme=function(){return this.renderer.getTheme()},e.prototype.setStyle=function(e){this.renderer.setStyle(e);},e.prototype.unsetStyle=function(e){this.renderer.unsetStyle(e);},e.prototype.getFontSize=function(){return this.getOption("fontSize")||s.computedStyle(this.container).fontSize},e.prototype.setFontSize=function(e){this.setOption("fontSize",e);},e.prototype.$highlightBrackets=function(){if(this.$highlightPending)return;var e=this;this.$highlightPending=!0,setTimeout(function(){e.$highlightPending=!1;var t=e.session;if(!t||t.destroyed)return;t.$bracketHighlight&&(t.$bracketHighlight.markerIds.forEach(function(e){t.removeMarker(e);}),t.$bracketHighlight=null);var n=e.getCursorPosition(),r=e.getKeyboardHandler(),i=r&&r.$getDirectionForHighlight&&r.$getDirectionForHighlight(e),s=t.getMatchingBracketRanges(n,i);if(!s){var o=new b(t,n.row,n.column),u=o.getCurrentToken();if(u&&/\b(?:tag-open|tag-name)/.test(u.type)){var a=t.getMatchingTags(n);a&&(s=[a.openTagName,a.closeTagName]);}}!s&&t.$mode.getMatching&&(s=t.$mode.getMatching(e.session));if(!s){e.getHighlightIndentGuides()&&e.renderer.$textLayer.$highlightIndentGuide();return}var f="ace_bracket";Array.isArray(s)?s.length==1&&(f="ace_error_bracket"):s=[s],s.length==2&&(d.comparePoints(s[0].end,s[1].start)==0?s=[d.fromPoints(s[0].start,s[1].end)]:d.comparePoints(s[0].start,s[1].end)==0&&(s=[d.fromPoints(s[1].start,s[0].end)])),t.$bracketHighlight={ranges:s,markerIds:s.map(function(e){return t.addMarker(e,f,"text")})},e.getHighlightIndentGuides()&&e.renderer.$textLayer.$highlightIndentGuide();},50);},e.prototype.focus=function(){this.textInput.focus();},e.prototype.isFocused=function(){return this.textInput.isFocused()},e.prototype.blur=function(){this.textInput.blur();},e.prototype.onFocus=function(e){if(this.$isFocused)return;this.$isFocused=!0,this.renderer.showCursor(),this.renderer.visualizeFocus(),this._emit("focus",e);},e.prototype.onBlur=function(e){if(!this.$isFocused)return;this.$isFocused=!1,this.renderer.hideCursor(),this.renderer.visualizeBlur(),this._emit("blur",e);},e.prototype.$cursorChange=function(){this.renderer.updateCursor(),this.$highlightBrackets(),this.$updateHighlightActiveLine();},e.prototype.onDocumentChange=function(e){var t=this.session.$useWrapMode,n=e.start.row==e.end.row?e.end.row:Infinity;this.renderer.updateLines(e.start.row,n,t),this._signal("change",e),this.$cursorChange();},e.prototype.onTokenizerUpdate=function(e){var t=e.data;this.renderer.updateLines(t.first,t.last);},e.prototype.onScrollTopChange=function(){this.renderer.scrollToY(this.session.getScrollTop());},e.prototype.onScrollLeftChange=function(){this.renderer.scrollToX(this.session.getScrollLeft());},e.prototype.onCursorChange=function(){this.$cursorChange(),this._signal("changeSelection");},e.prototype.$updateHighlightActiveLine=function(){var e=this.getSession(),t;if(this.$highlightActiveLine){if(this.$selectionStyle!="line"||!this.selection.isMultiLine())t=this.getCursorPosition();this.renderer.theme&&this.renderer.theme.$selectionColorConflict&&!this.selection.isEmpty()&&(t=!1),this.renderer.$maxLines&&this.session.getLength()===1&&!(this.renderer.$minLines>1)&&(t=!1);}if(e.$highlightLineMarker&&!t)e.removeMarker(e.$highlightLineMarker.id),e.$highlightLineMarker=null;else if(!e.$highlightLineMarker&&t){var n=new d(t.row,t.column,t.row,Infinity);n.id=e.addMarker(n,"ace_active-line","screenLine"),e.$highlightLineMarker=n;}else t&&(e.$highlightLineMarker.start.row=t.row,e.$highlightLineMarker.end.row=t.row,e.$highlightLineMarker.start.column=t.column,e._signal("changeBackMarker"));},e.prototype.onSelectionChange=function(e){var t=this.session;t.$selectionMarker&&t.removeMarker(t.$selectionMarker),t.$selectionMarker=null;if(!this.selection.isEmpty()){var n=this.selection.getRange(),r=this.getSelectionStyle();t.$selectionMarker=t.addMarker(n,"ace_selection",r);}else this.$updateHighlightActiveLine();var i=this.$highlightSelectedWord&&this.$getSelectionHighLightRegexp();this.session.highlight(i),this._signal("changeSelection");},e.prototype.$getSelectionHighLightRegexp=function(){var e=this.session,t=this.getSelectionRange();if(t.isEmpty()||t.isMultiLine())return;var n=t.start.column,r=t.end.column,i=e.getLine(t.start.row),s=i.substring(n,r);if(s.length>5e3||!/[\w\d]/.test(s))return;var o=this.$search.$assembleRegExp({wholeWord:!0,caseSensitive:!0,needle:s}),u=i.substring(n-1,r+1);if(!o.test(u))return;return o},e.prototype.onChangeFrontMarker=function(){this.renderer.updateFrontMarkers();},e.prototype.onChangeBackMarker=function(){this.renderer.updateBackMarkers();},e.prototype.onChangeBreakpoint=function(){this.renderer.updateBreakpoints();},e.prototype.onChangeAnnotation=function(){this.renderer.setAnnotations(this.session.getAnnotations());},e.prototype.onChangeMode=function(e){this.renderer.updateText(),this._emit("changeMode",e);},e.prototype.onChangeWrapLimit=function(){this.renderer.updateFull();},e.prototype.onChangeWrapMode=function(){this.renderer.onResize(!0);},e.prototype.onChangeFold=function(){this.$updateHighlightActiveLine(),this.renderer.updateFull();},e.prototype.getSelectedText=function(){return this.session.getTextRange(this.getSelectionRange())},e.prototype.getCopyText=function(){var e=this.getSelectedText(),t=this.session.doc.getNewLineCharacter(),n=!1;if(!e&&this.$copyWithEmptySelection){n=!0;var r=this.selection.getAllRanges();for(var i=0;i<r.length;i++){var s=r[i];if(i&&r[i-1].start.row==s.start.row)continue;e+=this.session.getLine(s.start.row)+t;}}var o={text:e};return this._signal("copy",o),x.lineMode=n?o.text:!1,o.text},e.prototype.onCopy=function(){this.commands.exec("copy",this);},e.prototype.onCut=function(){this.commands.exec("cut",this);},e.prototype.onPaste=function(e,t){var n={text:e,event:t};this.commands.exec("paste",this,n);},e.prototype.$handlePaste=function(e){typeof e=="string"&&(e={text:e}),this._signal("paste",e);var t=e.text,n=t===x.lineMode,r=this.session;if(!this.inMultiSelectMode||this.inVirtualSelectionMode)n?r.insert({row:this.selection.lead.row,column:0},t):this.insert(t);else if(n)this.selection.rangeList.ranges.forEach(function(e){r.insert({row:e.start.row,column:0},t);});else {var i=t.split(/\r\n|\r|\n/),s=this.selection.rangeList.ranges,o=i.length==2&&(!i[0]||!i[1]);if(i.length!=s.length||o)return this.commands.exec("insertstring",this,t);for(var u=s.length;u--;){var a=s[u];a.isEmpty()||r.remove(a),r.insert(a.start,i[u]);}}},e.prototype.execCommand=function(e,t){return this.commands.exec(e,this,t)},e.prototype.insert=function(e,t){var n=this.session,r=n.getMode(),i=this.getCursorPosition();if(this.getBehavioursEnabled()&&!t){var s=r.transformAction(n.getState(i.row),"insertion",this,n,e);s&&(e!==s.text&&(this.inVirtualSelectionMode||(this.session.mergeUndoDeltas=!1,this.mergeNextCommand=!1)),e=s.text);}e=="	"&&(e=this.session.getTabString());if(!this.selection.isEmpty()){var o=this.getSelectionRange();i=this.session.remove(o),this.clearSelection();}else if(this.session.getOverwrite()&&e.indexOf("\n")==-1){var o=new d.fromPoints(i,i);o.end.column+=e.length,this.session.remove(o);}if(e=="\n"||e=="\r\n"){var u=n.getLine(i.row);if(i.column>u.search(/\S|$/)){var a=u.substr(i.column).search(/\S|$/);n.doc.removeInLine(i.row,i.column,i.column+a);}}this.clearSelection();var f=i.column,l=n.getState(i.row),u=n.getLine(i.row),c=r.checkOutdent(l,u,e);n.insert(i,e),s&&s.selection&&(s.selection.length==2?this.selection.setSelectionRange(new d(i.row,f+s.selection[0],i.row,f+s.selection[1])):this.selection.setSelectionRange(new d(i.row+s.selection[0],s.selection[1],i.row+s.selection[2],s.selection[3])));if(this.$enableAutoIndent){if(n.getDocument().isNewLine(e)){var h=r.getNextLineIndent(l,u.slice(0,i.column),n.getTabString());n.insert({row:i.row+1,column:0},h);}c&&r.autoOutdent(l,n,i.row);}},e.prototype.autoIndent=function(){var e=this.session,t=e.getMode(),n,r;if(this.selection.isEmpty())n=0,r=e.doc.getLength()-1;else {var i=this.getSelectionRange();n=i.start.row,r=i.end.row;}var s="",o="",u="",a,f,l,c=e.getTabString();for(var h=n;h<=r;h++)h>0&&(s=e.getState(h-1),o=e.getLine(h-1),u=t.getNextLineIndent(s,o,c)),a=e.getLine(h),f=t.$getIndent(a),u!==f&&(f.length>0&&(l=new d(h,0,h,f.length),e.remove(l)),u.length>0&&e.insert({row:h,column:0},u)),t.autoOutdent(s,e,h);},e.prototype.onTextInput=function(e,t){if(!t)return this.keyBinding.onTextInput(e);this.startOperation({command:{name:"insertstring"}});var n=this.applyComposition.bind(this,e,t);this.selection.rangeCount?this.forEachSelection(n):n(),this.endOperation();},e.prototype.applyComposition=function(e,t){if(t.extendLeft||t.extendRight){var n=this.selection.getRange();n.start.column-=t.extendLeft,n.end.column+=t.extendRight,n.start.column<0&&(n.start.row--,n.start.column+=this.session.getLine(n.start.row).length+1),this.selection.setRange(n),!e&&!n.isEmpty()&&this.remove();}(e||!this.selection.isEmpty())&&this.insert(e,!0);if(t.restoreStart||t.restoreEnd){var n=this.selection.getRange();n.start.column-=t.restoreStart,n.end.column-=t.restoreEnd,this.selection.setRange(n);}},e.prototype.onCommandKey=function(e,t,n){return this.keyBinding.onCommandKey(e,t,n)},e.prototype.setOverwrite=function(e){this.session.setOverwrite(e);},e.prototype.getOverwrite=function(){return this.session.getOverwrite()},e.prototype.toggleOverwrite=function(){this.session.toggleOverwrite();},e.prototype.setScrollSpeed=function(e){this.setOption("scrollSpeed",e);},e.prototype.getScrollSpeed=function(){return this.getOption("scrollSpeed")},e.prototype.setDragDelay=function(e){this.setOption("dragDelay",e);},e.prototype.getDragDelay=function(){return this.getOption("dragDelay")},e.prototype.setSelectionStyle=function(e){this.setOption("selectionStyle",e);},e.prototype.getSelectionStyle=function(){return this.getOption("selectionStyle")},e.prototype.setHighlightActiveLine=function(e){this.setOption("highlightActiveLine",e);},e.prototype.getHighlightActiveLine=function(){return this.getOption("highlightActiveLine")},e.prototype.setHighlightGutterLine=function(e){this.setOption("highlightGutterLine",e);},e.prototype.getHighlightGutterLine=function(){return this.getOption("highlightGutterLine")},e.prototype.setHighlightSelectedWord=function(e){this.setOption("highlightSelectedWord",e);},e.prototype.getHighlightSelectedWord=function(){return this.$highlightSelectedWord},e.prototype.setAnimatedScroll=function(e){this.renderer.setAnimatedScroll(e);},e.prototype.getAnimatedScroll=function(){return this.renderer.getAnimatedScroll()},e.prototype.setShowInvisibles=function(e){this.renderer.setShowInvisibles(e);},e.prototype.getShowInvisibles=function(){return this.renderer.getShowInvisibles()},e.prototype.setDisplayIndentGuides=function(e){this.renderer.setDisplayIndentGuides(e);},e.prototype.getDisplayIndentGuides=function(){return this.renderer.getDisplayIndentGuides()},e.prototype.setHighlightIndentGuides=function(e){this.renderer.setHighlightIndentGuides(e);},e.prototype.getHighlightIndentGuides=function(){return this.renderer.getHighlightIndentGuides()},e.prototype.setShowPrintMargin=function(e){this.renderer.setShowPrintMargin(e);},e.prototype.getShowPrintMargin=function(){return this.renderer.getShowPrintMargin()},e.prototype.setPrintMarginColumn=function(e){this.renderer.setPrintMarginColumn(e);},e.prototype.getPrintMarginColumn=function(){return this.renderer.getPrintMarginColumn()},e.prototype.setReadOnly=function(e){this.setOption("readOnly",e);},e.prototype.getReadOnly=function(){return this.getOption("readOnly")},e.prototype.setBehavioursEnabled=function(e){this.setOption("behavioursEnabled",e);},e.prototype.getBehavioursEnabled=function(){return this.getOption("behavioursEnabled")},e.prototype.setWrapBehavioursEnabled=function(e){this.setOption("wrapBehavioursEnabled",e);},e.prototype.getWrapBehavioursEnabled=function(){return this.getOption("wrapBehavioursEnabled")},e.prototype.setShowFoldWidgets=function(e){this.setOption("showFoldWidgets",e);},e.prototype.getShowFoldWidgets=function(){return this.getOption("showFoldWidgets")},e.prototype.setFadeFoldWidgets=function(e){this.setOption("fadeFoldWidgets",e);},e.prototype.getFadeFoldWidgets=function(){return this.getOption("fadeFoldWidgets")},e.prototype.remove=function(e){this.selection.isEmpty()&&(e=="left"?this.selection.selectLeft():this.selection.selectRight());var t=this.getSelectionRange();if(this.getBehavioursEnabled()){var n=this.session,r=n.getState(t.start.row),i=n.getMode().transformAction(r,"deletion",this,n,t);if(t.end.column===0){var s=n.getTextRange(t);if(s[s.length-1]=="\n"){var o=n.getLine(t.end.row);/^\s+$/.test(o)&&(t.end.column=o.length);}}i&&(t=i);}this.session.remove(t),this.clearSelection();},e.prototype.removeWordRight=function(){this.selection.isEmpty()&&this.selection.selectWordRight(),this.session.remove(this.getSelectionRange()),this.clearSelection();},e.prototype.removeWordLeft=function(){this.selection.isEmpty()&&this.selection.selectWordLeft(),this.session.remove(this.getSelectionRange()),this.clearSelection();},e.prototype.removeToLineStart=function(){this.selection.isEmpty()&&this.selection.selectLineStart(),this.selection.isEmpty()&&this.selection.selectLeft(),this.session.remove(this.getSelectionRange()),this.clearSelection();},e.prototype.removeToLineEnd=function(){this.selection.isEmpty()&&this.selection.selectLineEnd();var e=this.getSelectionRange();e.start.column==e.end.column&&e.start.row==e.end.row&&(e.end.column=0,e.end.row++),this.session.remove(e),this.clearSelection();},e.prototype.splitLine=function(){this.selection.isEmpty()||(this.session.remove(this.getSelectionRange()),this.clearSelection());var e=this.getCursorPosition();this.insert("\n"),this.moveCursorToPosition(e);},e.prototype.setGhostText=function(e,t){this.session.widgetManager||(this.session.widgetManager=new w(this.session),this.session.widgetManager.attach(this)),this.renderer.setGhostText(e,t);},e.prototype.removeGhostText=function(){if(!this.session.widgetManager)return;this.renderer.removeGhostText();},e.prototype.transposeLetters=function(){if(!this.selection.isEmpty())return;var e=this.getCursorPosition(),t=e.column;if(t===0)return;var n=this.session.getLine(e.row),r,i;t<n.length?(r=n.charAt(t)+n.charAt(t-1),i=new d(e.row,t-1,e.row,t+1)):(r=n.charAt(t-1)+n.charAt(t-2),i=new d(e.row,t-2,e.row,t)),this.session.replace(i,r),this.session.selection.moveToPosition(i.end);},e.prototype.toLowerCase=function(){var e=this.getSelectionRange();this.selection.isEmpty()&&this.selection.selectWord();var t=this.getSelectionRange(),n=this.session.getTextRange(t);this.session.replace(t,n.toLowerCase()),this.selection.setSelectionRange(e);},e.prototype.toUpperCase=function(){var e=this.getSelectionRange();this.selection.isEmpty()&&this.selection.selectWord();var t=this.getSelectionRange(),n=this.session.getTextRange(t);this.session.replace(t,n.toUpperCase()),this.selection.setSelectionRange(e);},e.prototype.indent=function(){var e=this.session,t=this.getSelectionRange();if(t.start.row<t.end.row){var n=this.$getSelectedRows();e.indentRows(n.first,n.last,"	");return}if(t.start.column<t.end.column){var r=e.getTextRange(t);if(!/^\s+$/.test(r)){var n=this.$getSelectedRows();e.indentRows(n.first,n.last,"	");return}}var i=e.getLine(t.start.row),s=t.start,u=e.getTabSize(),a=e.documentToScreenColumn(s.row,s.column);if(this.session.getUseSoftTabs())var f=u-a%u,l=o.stringRepeat(" ",f);else {var f=a%u;while(i[t.start.column-1]==" "&&f)t.start.column--,f--;this.selection.setSelectionRange(t),l="	";}return this.insert(l)},e.prototype.blockIndent=function(){var e=this.$getSelectedRows();this.session.indentRows(e.first,e.last,"	");},e.prototype.blockOutdent=function(){var e=this.session.getSelection();this.session.outdentRows(e.getRange());},e.prototype.sortLines=function(){var e=this.$getSelectedRows(),t=this.session,n=[];for(var r=e.first;r<=e.last;r++)n.push(t.getLine(r));n.sort(function(e,t){return e.toLowerCase()<t.toLowerCase()?-1:e.toLowerCase()>t.toLowerCase()?1:0});var i=new d(0,0,0,0);for(var r=e.first;r<=e.last;r++){var s=t.getLine(r);i.start.row=r,i.end.row=r,i.end.column=s.length,t.replace(i,n[r-e.first]);}},e.prototype.toggleCommentLines=function(){var e=this.session.getState(this.getCursorPosition().row),t=this.$getSelectedRows();this.session.getMode().toggleCommentLines(e,this.session,t.first,t.last);},e.prototype.toggleBlockComment=function(){var e=this.getCursorPosition(),t=this.session.getState(e.row),n=this.getSelectionRange();this.session.getMode().toggleBlockComment(t,this.session,n,e);},e.prototype.getNumberAt=function(e,t){var n=/[\-]?[0-9]+(?:\.[0-9]+)?/g;n.lastIndex=0;var r=this.session.getLine(e);while(n.lastIndex<t){var i=n.exec(r);if(i.index<=t&&i.index+i[0].length>=t){var s={value:i[0],start:i.index,end:i.index+i[0].length};return s}}return null},e.prototype.modifyNumber=function(e){var t=this.selection.getCursor().row,n=this.selection.getCursor().column,r=new d(t,n-1,t,n),i=this.session.getTextRange(r);if(!isNaN(parseFloat(i))&&isFinite(i)){var s=this.getNumberAt(t,n);if(s){var o=s.value.indexOf(".")>=0?s.start+s.value.indexOf(".")+1:s.end,u=s.start+s.value.length-o,a=parseFloat(s.value);a*=Math.pow(10,u),o!==s.end&&n<o?e*=Math.pow(10,s.end-n-1):e*=Math.pow(10,s.end-n),a+=e,a/=Math.pow(10,u);var f=a.toFixed(u),l=new d(t,s.start,t,s.end);this.session.replace(l,f),this.moveCursorTo(t,Math.max(s.start+1,n+f.length-s.value.length));}}else this.toggleWord();},e.prototype.toggleWord=function(){var e=this.selection.getCursor().row,t=this.selection.getCursor().column;this.selection.selectWord();var n=this.getSelectedText(),r=this.selection.getWordRange().start.column,i=n.replace(/([a-z]+|[A-Z]+)(?=[A-Z_]|$)/g,"$1 ").split(/\s/),s=t-r-1;s<0&&(s=0);var u=0,a=0,f=this;n.match(/[A-Za-z0-9_]+/)&&i.forEach(function(t,i){a=u+t.length,s>=u&&s<=a&&(n=t,f.selection.clearSelection(),f.moveCursorTo(e,u+r),f.selection.selectTo(e,a+r)),u=a;});var l=this.$toggleWordPairs,c;for(var h=0;h<l.length;h++){var p=l[h];for(var d=0;d<=1;d++){var v=+!d,m=n.match(new RegExp("^\\s?_?("+o.escapeRegExp(p[d])+")\\s?$","i"));if(m){var g=n.match(new RegExp("([_]|^|\\s)("+o.escapeRegExp(m[1])+")($|\\s)","g"));g&&(c=n.replace(new RegExp(o.escapeRegExp(p[d]),"i"),function(e){var t=p[v];return e.toUpperCase()==e?t=t.toUpperCase():e.charAt(0).toUpperCase()==e.charAt(0)&&(t=t.substr(0,0)+p[v].charAt(0).toUpperCase()+t.substr(1)),t}),this.insert(c),c="");}}}},e.prototype.findLinkAt=function(e,t){var n,i,s=this.session.getLine(e),o=s.split(/((?:https?|ftp):\/\/[\S]+)/),u=t;u<0&&(u=0);var a=0,f=0,l;try{for(var c=r(o),h=c.next();!h.done;h=c.next()){var p=h.value;f=a+p.length;if(u>=a&&u<=f&&p.match(/((?:https?|ftp):\/\/[\S]+)/)){l=p.replace(/[\s:.,'";}\]]+$/,"");break}a=f;}}catch(d){n={error:d};}finally{try{h&&!h.done&&(i=c.return)&&i.call(c);}finally{if(n)throw n.error}}return l},e.prototype.openLink=function(){var e=this.selection.getCursor(),t=this.findLinkAt(e.row,e.column);return t&&window.open(t,"_blank"),t!=null},e.prototype.removeLines=function(){var e=this.$getSelectedRows();this.session.removeFullLines(e.first,e.last),this.clearSelection();},e.prototype.duplicateSelection=function(){var e=this.selection,t=this.session,n=e.getRange(),r=e.isBackwards();if(n.isEmpty()){var i=n.start.row;t.duplicateLines(i,i);}else {var s=r?n.start:n.end,o=t.insert(s,t.getTextRange(n),!1);n.start=s,n.end=o,e.setSelectionRange(n,r);}},e.prototype.moveLinesDown=function(){this.$moveLines(1,!1);},e.prototype.moveLinesUp=function(){this.$moveLines(-1,!1);},e.prototype.moveText=function(e,t,n){return this.session.moveText(e,t,n)},e.prototype.copyLinesUp=function(){this.$moveLines(-1,!0);},e.prototype.copyLinesDown=function(){this.$moveLines(1,!0);},e.prototype.$moveLines=function(e,t){var n,r,i=this.selection;if(!i.inMultiSelectMode||this.inVirtualSelectionMode){var s=i.toOrientedRange();n=this.$getSelectedRows(s),r=this.session.$moveLines(n.first,n.last,t?0:e),t&&e==-1&&(r=0),s.moveBy(r,0),i.fromOrientedRange(s);}else {var o=i.rangeList.ranges;i.rangeList.detach(this.session),this.inVirtualSelectionMode=!0;var u=0,a=0,f=o.length;for(var l=0;l<f;l++){var c=l;o[l].moveBy(u,0),n=this.$getSelectedRows(o[l]);var h=n.first,p=n.last;while(++l<f){a&&o[l].moveBy(a,0);var d=this.$getSelectedRows(o[l]);if(t&&d.first!=p)break;if(!t&&d.first>p+1)break;p=d.last;}l--,u=this.session.$moveLines(h,p,t?0:e),t&&e==-1&&(c=l+1);while(c<=l)o[c].moveBy(u,0),c++;t||(u=0),a+=u;}i.fromOrientedRange(i.ranges[0]),i.rangeList.attach(this.session),this.inVirtualSelectionMode=!1;}},e.prototype.$getSelectedRows=function(e){return e=(e||this.getSelectionRange()).collapseRows(),{first:this.session.getRowFoldStart(e.start.row),last:this.session.getRowFoldEnd(e.end.row)}},e.prototype.onCompositionStart=function(e){this.renderer.showComposition(e);},e.prototype.onCompositionUpdate=function(e){this.renderer.setCompositionText(e);},e.prototype.onCompositionEnd=function(){this.renderer.hideComposition();},e.prototype.getFirstVisibleRow=function(){return this.renderer.getFirstVisibleRow()},e.prototype.getLastVisibleRow=function(){return this.renderer.getLastVisibleRow()},e.prototype.isRowVisible=function(e){return e>=this.getFirstVisibleRow()&&e<=this.getLastVisibleRow()},e.prototype.isRowFullyVisible=function(e){return e>=this.renderer.getFirstFullyVisibleRow()&&e<=this.renderer.getLastFullyVisibleRow()},e.prototype.$getVisibleRowCount=function(){return this.renderer.getScrollBottomRow()-this.renderer.getScrollTopRow()+1},e.prototype.$moveByPage=function(e,t){var n=this.renderer,r=this.renderer.layerConfig,i=e*Math.floor(r.height/r.lineHeight);t===!0?this.selection.$moveSelection(function(){this.moveCursorBy(i,0);}):t===!1&&(this.selection.moveCursorBy(i,0),this.selection.clearSelection());var s=n.scrollTop;n.scrollBy(0,i*r.lineHeight),t!=null&&n.scrollCursorIntoView(null,.5),n.animateScrolling(s);},e.prototype.selectPageDown=function(){this.$moveByPage(1,!0);},e.prototype.selectPageUp=function(){this.$moveByPage(-1,!0);},e.prototype.gotoPageDown=function(){this.$moveByPage(1,!1);},e.prototype.gotoPageUp=function(){this.$moveByPage(-1,!1);},e.prototype.scrollPageDown=function(){this.$moveByPage(1);},e.prototype.scrollPageUp=function(){this.$moveByPage(-1);},e.prototype.scrollToRow=function(e){this.renderer.scrollToRow(e);},e.prototype.scrollToLine=function(e,t,n,r){this.renderer.scrollToLine(e,t,n,r);},e.prototype.centerSelection=function(){var e=this.getSelectionRange(),t={row:Math.floor(e.start.row+(e.end.row-e.start.row)/2),column:Math.floor(e.start.column+(e.end.column-e.start.column)/2)};this.renderer.alignCursor(t,.5);},e.prototype.getCursorPosition=function(){return this.selection.getCursor()},e.prototype.getCursorPositionScreen=function(){return this.session.documentToScreenPosition(this.getCursorPosition())},e.prototype.getSelectionRange=function(){return this.selection.getRange()},e.prototype.selectAll=function(){this.selection.selectAll();},e.prototype.clearSelection=function(){this.selection.clearSelection();},e.prototype.moveCursorTo=function(e,t){this.selection.moveCursorTo(e,t);},e.prototype.moveCursorToPosition=function(e){this.selection.moveCursorToPosition(e);},e.prototype.jumpToMatching=function(e,t){var n=this.getCursorPosition(),r=new b(this.session,n.row,n.column),i=r.getCurrentToken(),s=0;i&&i.type.indexOf("tag-name")!==-1&&(i=r.stepBackward());var o=i||r.stepForward();if(!o)return;var u,a=!1,f={},l=n.column-o.start,c,h={")":"(","(":"(","]":"[","[":"[","{":"{","}":"{"};do{if(o.value.match(/[{}()\[\]]/g))for(;l<o.value.length&&!a;l++){if(!h[o.value[l]])continue;c=h[o.value[l]]+"."+o.type.replace("rparen","lparen"),isNaN(f[c])&&(f[c]=0);switch(o.value[l]){case"(":case"[":case"{":f[c]++;break;case")":case"]":case"}":f[c]--,f[c]===-1&&(u="bracket",a=!0);}}else o.type.indexOf("tag-name")!==-1&&(isNaN(f[o.value])&&(f[o.value]=0),i.value==="<"&&s>1?f[o.value]++:i.value==="</"&&f[o.value]--,f[o.value]===-1&&(u="tag",a=!0));a||(i=o,s++,o=r.stepForward(),l=0);}while(o&&!a);if(!u)return;var p,v;if(u==="bracket"){p=this.session.getBracketRange(n);if(!p){p=new d(r.getCurrentTokenRow(),r.getCurrentTokenColumn()+l-1,r.getCurrentTokenRow(),r.getCurrentTokenColumn()+l-1),v=p.start;if(t||v.row===n.row&&Math.abs(v.column-n.column)<2)p=this.session.getBracketRange(v);}}else if(u==="tag"){if(!o||o.type.indexOf("tag-name")===-1)return;p=new d(r.getCurrentTokenRow(),r.getCurrentTokenColumn()-2,r.getCurrentTokenRow(),r.getCurrentTokenColumn()-2);if(p.compare(n.row,n.column)===0){var m=this.session.getMatchingTags(n);m&&(m.openTag.contains(n.row,n.column)?(p=m.closeTag,v=p.start):(p=m.openTag,m.closeTag.start.row===n.row&&m.closeTag.start.column===n.column?v=p.end:v=p.start));}v=v||p.start;}v=p&&p.cursor||v,v&&(e?p&&t?this.selection.setRange(p):p&&p.isEqual(this.getSelectionRange())?this.clearSelection():this.selection.selectTo(v.row,v.column):this.selection.moveTo(v.row,v.column));},e.prototype.gotoLine=function(e,t,n){this.selection.clearSelection(),this.session.unfold({row:e-1,column:t||0}),this.exitMultiSelectMode&&this.exitMultiSelectMode(),this.moveCursorTo(e-1,t||0),this.isRowFullyVisible(e-1)||this.scrollToLine(e-1,!0,n);},e.prototype.navigateTo=function(e,t){this.selection.moveTo(e,t);},e.prototype.navigateUp=function(e){if(this.selection.isMultiLine()&&!this.selection.isBackwards()){var t=this.selection.anchor.getPosition();return this.moveCursorToPosition(t)}this.selection.clearSelection(),this.selection.moveCursorBy(-e||-1,0);},e.prototype.navigateDown=function(e){if(this.selection.isMultiLine()&&this.selection.isBackwards()){var t=this.selection.anchor.getPosition();return this.moveCursorToPosition(t)}this.selection.clearSelection(),this.selection.moveCursorBy(e||1,0);},e.prototype.navigateLeft=function(e){if(!this.selection.isEmpty()){var t=this.getSelectionRange().start;this.moveCursorToPosition(t);}else {e=e||1;while(e--)this.selection.moveCursorLeft();}this.clearSelection();},e.prototype.navigateRight=function(e){if(!this.selection.isEmpty()){var t=this.getSelectionRange().end;this.moveCursorToPosition(t);}else {e=e||1;while(e--)this.selection.moveCursorRight();}this.clearSelection();},e.prototype.navigateLineStart=function(){this.selection.moveCursorLineStart(),this.clearSelection();},e.prototype.navigateLineEnd=function(){this.selection.moveCursorLineEnd(),this.clearSelection();},e.prototype.navigateFileEnd=function(){this.selection.moveCursorFileEnd(),this.clearSelection();},e.prototype.navigateFileStart=function(){this.selection.moveCursorFileStart(),this.clearSelection();},e.prototype.navigateWordRight=function(){this.selection.moveCursorWordRight(),this.clearSelection();},e.prototype.navigateWordLeft=function(){this.selection.moveCursorWordLeft(),this.clearSelection();},e.prototype.replace=function(e,t){t&&this.$search.set(t);var n=this.$search.find(this.session),r=0;return n?(this.$tryReplace(n,e)&&(r=1),this.selection.setSelectionRange(n),this.renderer.scrollSelectionIntoView(n.start,n.end),r):r},e.prototype.replaceAll=function(e,t){t&&this.$search.set(t);var n=this.$search.findAll(this.session),r=0;if(!n.length)return r;var i=this.getSelectionRange();this.selection.moveTo(0,0);for(var s=n.length-1;s>=0;--s)this.$tryReplace(n[s],e)&&r++;return this.selection.setSelectionRange(i),r},e.prototype.$tryReplace=function(e,t){var n=this.session.getTextRange(e);return t=this.$search.replace(n,t),t!==null?(e.end=this.session.replace(e,t),e):null},e.prototype.getLastSearchOptions=function(){return this.$search.getOptions()},e.prototype.find=function(e,t,n){t||(t={}),typeof e=="string"||e instanceof RegExp?t.needle=e:typeof e=="object"&&i.mixin(t,e);var r=this.selection.getRange();t.needle==null&&(e=this.session.getTextRange(r)||this.$search.$options.needle,e||(r=this.session.getWordRange(r.start.row,r.start.column),e=this.session.getTextRange(r)),this.$search.set({needle:e})),this.$search.set(t),t.start||this.$search.set({start:r});var s=this.$search.find(this.session);if(t.preventScroll)return s;if(s)return this.revealRange(s,n),s;t.backwards?r.start=r.end:r.end=r.start,this.selection.setRange(r);},e.prototype.findNext=function(e,t){this.find({skipCurrent:!0,backwards:!1},e,t);},e.prototype.findPrevious=function(e,t){this.find(e,{skipCurrent:!0,backwards:!0},t);},e.prototype.revealRange=function(e,t){this.session.unfold(e),this.selection.setSelectionRange(e);var n=this.renderer.scrollTop;this.renderer.scrollSelectionIntoView(e.start,e.end,.5),t!==!1&&this.renderer.animateScrolling(n);},e.prototype.undo=function(){this.session.getUndoManager().undo(this.session),this.renderer.scrollCursorIntoView(null,.5);},e.prototype.redo=function(){this.session.getUndoManager().redo(this.session),this.renderer.scrollCursorIntoView(null,.5);},e.prototype.destroy=function(){this.$toDestroy&&(this.$toDestroy.forEach(function(e){e.destroy();}),this.$toDestroy=null),this.$mouseHandler&&this.$mouseHandler.destroy(),this.renderer.destroy(),this._signal("destroy",this),this.session&&this.session.destroy(),this._$emitInputEvent&&this._$emitInputEvent.cancel(),this.removeAllListeners();},e.prototype.setAutoScrollEditorIntoView=function(e){if(!e)return;var t,n=this,r=!1;this.$scrollAnchor||(this.$scrollAnchor=document.createElement("div"));var i=this.$scrollAnchor;i.style.cssText="position:absolute",this.container.insertBefore(i,this.container.firstChild);var s=this.on("changeSelection",function(){r=!0;}),o=this.renderer.on("beforeRender",function(){r&&(t=n.renderer.container.getBoundingClientRect());}),u=this.renderer.on("afterRender",function(){if(r&&t&&(n.isFocused()||n.searchBox&&n.searchBox.isFocused())){var e=n.renderer,s=e.$cursorLayer.$pixelPos,o=e.layerConfig,u=s.top-o.offset;s.top>=0&&u+t.top<0?r=!0:s.top<o.height&&s.top+t.top+o.lineHeight>window.innerHeight?r=!1:r=null,r!=null&&(i.style.top=u+"px",i.style.left=s.left+"px",i.style.height=o.lineHeight+"px",i.scrollIntoView(r)),r=t=null;}});this.setAutoScrollEditorIntoView=function(e){if(e)return;delete this.setAutoScrollEditorIntoView,this.off("changeSelection",s),this.renderer.off("afterRender",u),this.renderer.off("beforeRender",o);};},e.prototype.$resetCursorStyle=function(){var e=this.$cursorStyle||"ace",t=this.renderer.$cursorLayer;if(!t)return;t.setSmoothBlinking(/smooth/.test(e)),t.isBlinking=!this.$readOnly&&e!="wide",s.setCssClass(t.element,"ace_slim-cursors",/slim/.test(e));},e.prototype.prompt=function(e,t,n){var r=this;y.loadModule("ace/ext/prompt",function(i){i.prompt(r,e,t,n);});},e}();N.$uid=0,N.prototype.curOp=null,N.prototype.prevOp={},N.prototype.$mergeableCommands=["backspace","del","insertstring"],N.prototype.$toggleWordPairs=[["first","last"],["true","false"],["yes","no"],["width","height"],["top","bottom"],["right","left"],["on","off"],["x","y"],["get","set"],["max","min"],["horizontal","vertical"],["show","hide"],["add","remove"],["up","down"],["before","after"],["even","odd"],["in","out"],["inside","outside"],["next","previous"],["increase","decrease"],["attach","detach"],["&&","||"],["==","!="]],i.implement(N.prototype,v),y.defineOptions(N.prototype,"editor",{selectionStyle:{set:function(e){this.onSelectionChange(),this._signal("changeSelectionStyle",{data:e});},initialValue:"line"},highlightActiveLine:{set:function(){this.$updateHighlightActiveLine();},initialValue:!0},highlightSelectedWord:{set:function(e){this.$onSelectionChange();},initialValue:!0},readOnly:{set:function(e){this.textInput.setReadOnly(e),this.$resetCursorStyle();},initialValue:!1},copyWithEmptySelection:{set:function(e){this.textInput.setCopyWithEmptySelection(e);},initialValue:!1},cursorStyle:{set:function(e){this.$resetCursorStyle();},values:["ace","slim","smooth","wide"],initialValue:"ace"},mergeUndoDeltas:{values:[!1,!0,"always"],initialValue:!0},behavioursEnabled:{initialValue:!0},wrapBehavioursEnabled:{initialValue:!0},enableAutoIndent:{initialValue:!0},autoScrollEditorIntoView:{set:function(e){this.setAutoScrollEditorIntoView(e);}},keyboardHandler:{set:function(e){this.setKeyboardHandler(e);},get:function(){return this.$keybindingId},handlesSet:!0},value:{set:function(e){this.session.setValue(e);},get:function(){return this.getValue()},handlesSet:!0,hidden:!0},session:{set:function(e){this.setSession(e);},get:function(){return this.session},handlesSet:!0,hidden:!0},showLineNumbers:{set:function(e){this.renderer.$gutterLayer.setShowLineNumbers(e),this.renderer.$loop.schedule(this.renderer.CHANGE_GUTTER),e&&this.$relativeLineNumbers?C.attach(this):C.detach(this);},initialValue:!0},relativeLineNumbers:{set:function(e){this.$showLineNumbers&&e?C.attach(this):C.detach(this);}},placeholder:{set:function(e){this.$updatePlaceholder||(this.$updatePlaceholder=function(){var e=this.session&&(this.renderer.$composition||this.session.getLength()>1||this.session.getLine(0).length>0);if(e&&this.renderer.placeholderNode)this.renderer.off("afterRender",this.$updatePlaceholder),s.removeCssClass(this.container,"ace_hasPlaceholder"),this.renderer.placeholderNode.remove(),this.renderer.placeholderNode=null;else if(!e&&!this.renderer.placeholderNode){this.renderer.on("afterRender",this.$updatePlaceholder),s.addCssClass(this.container,"ace_hasPlaceholder");var t=s.createElement("div");t.className="ace_placeholder",t.textContent=this.$placeholder||"",this.renderer.placeholderNode=t,this.renderer.content.appendChild(this.renderer.placeholderNode);}else !e&&this.renderer.placeholderNode&&(this.renderer.placeholderNode.textContent=this.$placeholder||"");}.bind(this),this.on("input",this.$updatePlaceholder)),this.$updatePlaceholder();}},enableKeyboardAccessibility:{set:function(e){var t={name:"blurTextInput",description:"Set focus to the editor content div to allow tabbing through the page",bindKey:"Esc",exec:function(e){e.blur(),e.renderer.scroller.focus();},readOnly:!0},n=function(e){if(e.target==this.renderer.scroller&&e.keyCode===T.enter){e.preventDefault();var t=this.getCursorPosition().row;this.isRowVisible(t)||this.scrollToLine(t,!0,!0),this.focus();}},r;e?(this.renderer.enableKeyboardAccessibility=!0,this.renderer.keyboardFocusClassName="ace_keyboard-focus",this.textInput.getElement().setAttribute("tabindex",-1),this.textInput.setNumberOfExtraLines(u.isWin?3:0),this.renderer.scroller.setAttribute("tabindex",0),this.renderer.scroller.setAttribute("role","group"),this.renderer.scroller.setAttribute("aria-roledescription",S("editor")),this.renderer.scroller.classList.add(this.renderer.keyboardFocusClassName),this.renderer.scroller.setAttribute("aria-label",S("Editor content, press Enter to start editing, press Escape to exit")),this.renderer.scroller.addEventListener("keyup",n.bind(this)),this.commands.addCommand(t),this.renderer.$gutter.setAttribute("tabindex",0),this.renderer.$gutter.setAttribute("aria-hidden",!1),this.renderer.$gutter.setAttribute("role","group"),this.renderer.$gutter.setAttribute("aria-roledescription",S("editor")),this.renderer.$gutter.setAttribute("aria-label",S("Editor gutter, press Enter to interact with controls using arrow keys, press Escape to exit")),this.renderer.$gutter.classList.add(this.renderer.keyboardFocusClassName),this.renderer.content.setAttribute("aria-hidden",!0),r||(r=new E(this)),r.addListener()):(this.renderer.enableKeyboardAccessibility=!1,this.textInput.getElement().setAttribute("tabindex",0),this.textInput.setNumberOfExtraLines(0),this.renderer.scroller.setAttribute("tabindex",-1),this.renderer.scroller.removeAttribute("role"),this.renderer.scroller.removeAttribute("aria-roledescription"),this.renderer.scroller.classList.remove(this.renderer.keyboardFocusClassName),this.renderer.scroller.removeAttribute("aria-label"),this.renderer.scroller.removeEventListener("keyup",n.bind(this)),this.commands.removeCommand(t),this.renderer.content.removeAttribute("aria-hidden"),this.renderer.$gutter.setAttribute("tabindex",-1),this.renderer.$gutter.setAttribute("aria-hidden",!0),this.renderer.$gutter.removeAttribute("role"),this.renderer.$gutter.removeAttribute("aria-roledescription"),this.renderer.$gutter.removeAttribute("aria-label"),this.renderer.$gutter.classList.remove(this.renderer.keyboardFocusClassName),r&&r.removeListener());},initialValue:!1},customScrollbar:"renderer",hScrollBarAlwaysVisible:"renderer",vScrollBarAlwaysVisible:"renderer",highlightGutterLine:"renderer",animatedScroll:"renderer",showInvisibles:"renderer",showPrintMargin:"renderer",printMarginColumn:"renderer",printMargin:"renderer",fadeFoldWidgets:"renderer",showFoldWidgets:"renderer",displayIndentGuides:"renderer",highlightIndentGuides:"renderer",showGutter:"renderer",fontSize:"renderer",fontFamily:"renderer",maxLines:"renderer",minLines:"renderer",scrollPastEnd:"renderer",fixedWidthGutter:"renderer",theme:"renderer",hasCssTransforms:"renderer",maxPixelHeight:"renderer",useTextareaForIME:"renderer",useResizeObserver:"renderer",useSvgGutterIcons:"renderer",showFoldedAnnotations:"renderer",scrollSpeed:"$mouseHandler",dragDelay:"$mouseHandler",dragEnabled:"$mouseHandler",focusTimeout:"$mouseHandler",tooltipFollowsMouse:"$mouseHandler",firstLineNumber:"session",overwrite:"session",newLineMode:"session",useWorker:"session",useSoftTabs:"session",navigateWithinSoftTabs:"session",tabSize:"session",wrap:"session",indentedSoftWrap:"session",foldStyle:"session",mode:"session"});var C={getText:function(e,t){return (Math.abs(e.selection.lead.row-t)||t+1+(t<9?"\u00b7":""))+""},getWidth:function(e,t,n){return Math.max(t.toString().length,(n.lastRow+1).toString().length,2)*n.characterWidth},update:function(e,t){t.renderer.$loop.schedule(t.renderer.CHANGE_GUTTER);},attach:function(e){e.renderer.$gutterLayer.$renderer=this,e.on("changeSelection",this.update),this.update(null,e);},detach:function(e){e.renderer.$gutterLayer.$renderer==this&&(e.renderer.$gutterLayer.$renderer=null),e.off("changeSelection",this.update),this.update(null,e);}};t.Editor=N;}),ace.define("ace/layer/lines",["require","exports","module","ace/lib/dom"],function(e,t,n){var r=e("../lib/dom"),i=function(){function e(e,t){this.element=e,this.canvasHeight=t||5e5,this.element.style.height=this.canvasHeight*2+"px",this.cells=[],this.cellCache=[],this.$offsetCoefficient=0;}return e.prototype.moveContainer=function(e){r.translate(this.element,0,-(e.firstRowScreen*e.lineHeight%this.canvasHeight)-e.offset*this.$offsetCoefficient);},e.prototype.pageChanged=function(e,t){return Math.floor(e.firstRowScreen*e.lineHeight/this.canvasHeight)!==Math.floor(t.firstRowScreen*t.lineHeight/this.canvasHeight)},e.prototype.computeLineTop=function(e,t,n){var r=t.firstRowScreen*t.lineHeight,i=Math.floor(r/this.canvasHeight),s=n.documentToScreenRow(e,0)*t.lineHeight;return s-i*this.canvasHeight},e.prototype.computeLineHeight=function(e,t,n){return t.lineHeight*n.getRowLineCount(e)},e.prototype.getLength=function(){return this.cells.length},e.prototype.get=function(e){return this.cells[e]},e.prototype.shift=function(){this.$cacheCell(this.cells.shift());},e.prototype.pop=function(){this.$cacheCell(this.cells.pop());},e.prototype.push=function(e){if(Array.isArray(e)){this.cells.push.apply(this.cells,e);var t=r.createFragment(this.element);for(var n=0;n<e.length;n++)t.appendChild(e[n].element);this.element.appendChild(t);}else this.cells.push(e),this.element.appendChild(e.element);},e.prototype.unshift=function(e){if(Array.isArray(e)){this.cells.unshift.apply(this.cells,e);var t=r.createFragment(this.element);for(var n=0;n<e.length;n++)t.appendChild(e[n].element);this.element.firstChild?this.element.insertBefore(t,this.element.firstChild):this.element.appendChild(t);}else this.cells.unshift(e),this.element.insertAdjacentElement("afterbegin",e.element);},e.prototype.last=function(){return this.cells.length?this.cells[this.cells.length-1]:null},e.prototype.$cacheCell=function(e){if(!e)return;e.element.remove(),this.cellCache.push(e);},e.prototype.createCell=function(e,t,n,i){var s=this.cellCache.pop();if(!s){var o=r.createElement("div");i&&i(o),this.element.appendChild(o),s={element:o,text:"",row:e};}return s.row=e,s},e}();t.Lines=i;}),ace.define("ace/layer/gutter",["require","exports","module","ace/lib/dom","ace/lib/oop","ace/lib/lang","ace/lib/event_emitter","ace/layer/lines","ace/config"],function(e,t,n){function l(e){var t=document.createTextNode("");e.appendChild(t);var n=r.createElement("span");e.appendChild(n);var i=r.createElement("span");e.appendChild(i);var s=r.createElement("span");return i.appendChild(s),e}var r=e("../lib/dom"),i=e("../lib/oop"),s=e("../lib/lang"),o=e("../lib/event_emitter").EventEmitter,u=e("./lines").Lines,a=e("../config").nls,f=function(){function e(e){this.element=r.createElement("div"),this.element.className="ace_layer ace_gutter-layer",e.appendChild(this.element),this.setShowFoldWidgets(this.$showFoldWidgets),this.gutterWidth=0,this.$annotations=[],this.$updateAnnotations=this.$updateAnnotations.bind(this),this.$lines=new u(this.element),this.$lines.$offsetCoefficient=1;}return e.prototype.setSession=function(e){this.session&&this.session.off("change",this.$updateAnnotations),this.session=e,e&&e.on("change",this.$updateAnnotations);},e.prototype.addGutterDecoration=function(e,t){window.console&&console.warn&&console.warn("deprecated use session.addGutterDecoration"),this.session.addGutterDecoration(e,t);},e.prototype.removeGutterDecoration=function(e,t){window.console&&console.warn&&console.warn("deprecated use session.removeGutterDecoration"),this.session.removeGutterDecoration(e,t);},e.prototype.setAnnotations=function(e){this.$annotations=[];for(var t=0;t<e.length;t++){var n=e[t],r=n.row,i=this.$annotations[r];i||(i=this.$annotations[r]={text:[],type:[]});var o=n.text,u=n.type;o=o?s.escapeHTML(o):n.html||"",i.text.indexOf(o)===-1&&(i.text.push(o),i.type.push(u));var a=n.className;a?i.className=a:u=="error"?i.className=" ace_error":u=="warning"&&i.className!=" ace_error"?i.className=" ace_warning":u=="info"&&!i.className&&(i.className=" ace_info");}},e.prototype.$updateAnnotations=function(e){if(!this.$annotations.length)return;var t=e.start.row,n=e.end.row-t;if(n!==0)if(e.action=="remove")this.$annotations.splice(t,n+1,null);else {var r=new Array(n+1);r.unshift(t,1),this.$annotations.splice.apply(this.$annotations,r);}},e.prototype.update=function(e){this.config=e;var t=this.session,n=e.firstRow,r=Math.min(e.lastRow+e.gutterOffset,t.getLength()-1);this.oldLastRow=r,this.config=e,this.$lines.moveContainer(e),this.$updateCursorRow();var i=t.getNextFoldLine(n),s=i?i.start.row:Infinity,o=null,u=-1,a=n;for(;;){a>s&&(a=i.end.row+1,i=t.getNextFoldLine(a,i),s=i?i.start.row:Infinity);if(a>r){while(this.$lines.getLength()>u+1)this.$lines.pop();break}o=this.$lines.get(++u),o?o.row=a:(o=this.$lines.createCell(a,e,this.session,l),this.$lines.push(o)),this.$renderCell(o,e,i,a),a++;}this._signal("afterRender"),this.$updateGutterWidth(e);},e.prototype.$updateGutterWidth=function(e){var t=this.session,n=t.gutterRenderer||this.$renderer,r=t.$firstLineNumber,i=this.$lines.last()?this.$lines.last().text:"";if(this.$fixedWidth||t.$useWrapMode)i=t.getLength()+r-1;var s=n?n.getWidth(t,i,e):i.toString().length*e.characterWidth,o=this.$padding||this.$computePadding();s+=o.left+o.right,s!==this.gutterWidth&&!isNaN(s)&&(this.gutterWidth=s,this.element.parentNode.style.width=this.element.style.width=Math.ceil(this.gutterWidth)+"px",this._signal("changeGutterWidth",s));},e.prototype.$updateCursorRow=function(){if(!this.$highlightGutterLine)return;var e=this.session.selection.getCursor();if(this.$cursorRow===e.row)return;this.$cursorRow=e.row;},e.prototype.updateLineHighlight=function(){if(!this.$highlightGutterLine)return;var e=this.session.selection.cursor.row;this.$cursorRow=e;if(this.$cursorCell&&this.$cursorCell.row==e)return;this.$cursorCell&&(this.$cursorCell.element.className=this.$cursorCell.element.className.replace("ace_gutter-active-line ",""));var t=this.$lines.cells;this.$cursorCell=null;for(var n=0;n<t.length;n++){var r=t[n];if(r.row>=this.$cursorRow){if(r.row>this.$cursorRow){var i=this.session.getFoldLine(this.$cursorRow);if(!(n>0&&i&&i.start.row==t[n-1].row))break;r=t[n-1];}r.element.className="ace_gutter-active-line "+r.element.className,this.$cursorCell=r;break}}},e.prototype.scrollLines=function(e){var t=this.config;this.config=e,this.$updateCursorRow();if(this.$lines.pageChanged(t,e))return this.update(e);this.$lines.moveContainer(e);var n=Math.min(e.lastRow+e.gutterOffset,this.session.getLength()-1),r=this.oldLastRow;this.oldLastRow=n;if(!t||r<e.firstRow)return this.update(e);if(n<t.firstRow)return this.update(e);if(t.firstRow<e.firstRow)for(var i=this.session.getFoldedRowCount(t.firstRow,e.firstRow-1);i>0;i--)this.$lines.shift();if(r>n)for(var i=this.session.getFoldedRowCount(n+1,r);i>0;i--)this.$lines.pop();e.firstRow<t.firstRow&&this.$lines.unshift(this.$renderLines(e,e.firstRow,t.firstRow-1)),n>r&&this.$lines.push(this.$renderLines(e,r+1,n)),this.updateLineHighlight(),this._signal("afterRender"),this.$updateGutterWidth(e);},e.prototype.$renderLines=function(e,t,n){var r=[],i=t,s=this.session.getNextFoldLine(i),o=s?s.start.row:Infinity;for(;;){i>o&&(i=s.end.row+1,s=this.session.getNextFoldLine(i,s),o=s?s.start.row:Infinity);if(i>n)break;var u=this.$lines.createCell(i,e,this.session,l);this.$renderCell(u,e,s,i),r.push(u),i++;}return r},e.prototype.$renderCell=function(e,t,n,i){var s=e.element,o=this.session,u=s.childNodes[0],f=s.childNodes[1],l=s.childNodes[2],c=l.firstChild,h=o.$firstLineNumber,p=o.$breakpoints,d=o.$decorations,v=o.gutterRenderer||this.$renderer,m=this.$showFoldWidgets&&o.foldWidgets,g=n?n.start.row:Number.MAX_VALUE,y=t.lineHeight+"px",b=this.$useSvgGutterIcons?"ace_gutter-cell_svg-icons ":"ace_gutter-cell ",w=this.$useSvgGutterIcons?"ace_icon_svg":"ace_icon",E=(v?v.getText(o,i):i+h).toString();this.$highlightGutterLine&&(i==this.$cursorRow||n&&i<this.$cursorRow&&i>=g&&this.$cursorRow<=n.end.row)&&(b+="ace_gutter-active-line ",this.$cursorCell!=e&&(this.$cursorCell&&(this.$cursorCell.element.className=this.$cursorCell.element.className.replace("ace_gutter-active-line ","")),this.$cursorCell=e)),p[i]&&(b+=p[i]),d[i]&&(b+=d[i]),this.$annotations[i]&&i!==g&&(b+=this.$annotations[i].className);if(m){var S=m[i];S==null&&(S=m[i]=o.getFoldWidget(i));}if(S){var x="ace_fold-widget ace_"+S,T=S=="start"&&i==g&&i<n.end.row;if(T){x+=" ace_closed";var N="",C=!1;for(var k=i+1;k<=n.end.row;k++){if(!this.$annotations[k])continue;if(this.$annotations[k].className===" ace_error"){C=!0,N=" ace_error_fold";break}if(this.$annotations[k].className===" ace_warning"){C=!0,N=" ace_warning_fold";continue}}b+=N;}else x+=" ace_open";f.className!=x&&(f.className=x),r.setStyle(f.style,"height",y),r.setStyle(f.style,"display","inline-block"),f.setAttribute("role","button"),f.setAttribute("tabindex","-1");var L=o.getFoldWidgetRange(i);L?f.setAttribute("aria-label",a("Toggle code folding, rows $0 through $1",[L.start.row+1,L.end.row+1])):n?f.setAttribute("aria-label",a("Toggle code folding, rows $0 through $1",[n.start.row+1,n.end.row+1])):f.setAttribute("aria-label",a("Toggle code folding, row $0",[i+1])),T?(f.setAttribute("aria-expanded","false"),f.setAttribute("title",a("Unfold code"))):(f.setAttribute("aria-expanded","true"),f.setAttribute("title",a("Fold code")));}else f&&(r.setStyle(f.style,"display","none"),f.setAttribute("tabindex","0"),f.removeAttribute("role"),f.removeAttribute("aria-label"));return C&&this.$showFoldedAnnotations?(l.className="ace_gutter_annotation",c.className=w,c.className+=N,r.setStyle(c.style,"height",y),r.setStyle(l.style,"display","block"),r.setStyle(l.style,"height",y),l.setAttribute("aria-label",a("Read annotations row $0",[E])),l.setAttribute("tabindex","-1"),l.setAttribute("role","button")):this.$annotations[i]?(l.className="ace_gutter_annotation",c.className=w,this.$useSvgGutterIcons?c.className+=this.$annotations[i].className:s.classList.add(this.$annotations[i].className.replace(" ","")),r.setStyle(c.style,"height",y),r.setStyle(l.style,"display","block"),r.setStyle(l.style,"height",y),l.setAttribute("aria-label",a("Read annotations row $0",[E])),l.setAttribute("tabindex","-1"),l.setAttribute("role","button")):(r.setStyle(l.style,"display","none"),l.removeAttribute("aria-label"),l.removeAttribute("role"),l.setAttribute("tabindex","0")),E!==u.data&&(u.data=E),s.className!=b&&(s.className=b),r.setStyle(e.element.style,"height",this.$lines.computeLineHeight(i,t,o)+"px"),r.setStyle(e.element.style,"top",this.$lines.computeLineTop(i,t,o)+"px"),e.text=E,l.style.display==="none"&&f.style.display==="none"?e.element.setAttribute("aria-hidden",!0):e.element.setAttribute("aria-hidden",!1),e},e.prototype.setHighlightGutterLine=function(e){this.$highlightGutterLine=e;},e.prototype.setShowLineNumbers=function(e){this.$renderer=!e&&{getWidth:function(){return 0},getText:function(){return ""}};},e.prototype.getShowLineNumbers=function(){return this.$showLineNumbers},e.prototype.setShowFoldWidgets=function(e){e?r.addCssClass(this.element,"ace_folding-enabled"):r.removeCssClass(this.element,"ace_folding-enabled"),this.$showFoldWidgets=e,this.$padding=null;},e.prototype.getShowFoldWidgets=function(){return this.$showFoldWidgets},e.prototype.$computePadding=function(){if(!this.element.firstChild)return {left:0,right:0};var e=r.computedStyle(this.element.firstChild);return this.$padding={},this.$padding.left=(parseInt(e.borderLeftWidth)||0)+(parseInt(e.paddingLeft)||0)+1,this.$padding.right=(parseInt(e.borderRightWidth)||0)+(parseInt(e.paddingRight)||0),this.$padding},e.prototype.getRegion=function(e){var t=this.$padding||this.$computePadding(),n=this.element.getBoundingClientRect();if(e.x<t.left+n.left)return "markers";if(this.$showFoldWidgets&&e.x>n.right-t.right)return "foldWidgets"},e}();f.prototype.$fixedWidth=!1,f.prototype.$highlightGutterLine=!0,f.prototype.$renderer="",f.prototype.$showLineNumbers=!0,f.prototype.$showFoldWidgets=!0,i.implement(f.prototype,o),t.Gutter=f;}),ace.define("ace/layer/marker",["require","exports","module","ace/range","ace/lib/dom"],function(e,t,n){function o(e,t,n,r){return (e?1:0)|(t?2:0)|(n?4:0)|(r?8:0)}var r=e("../range").Range,i=e("../lib/dom"),s=function(){function e(e){this.element=i.createElement("div"),this.element.className="ace_layer ace_marker-layer",e.appendChild(this.element);}return e.prototype.setPadding=function(e){this.$padding=e;},e.prototype.setSession=function(e){this.session=e;},e.prototype.setMarkers=function(e){this.markers=e;},e.prototype.elt=function(e,t){var n=this.i!=-1&&this.element.childNodes[this.i];n?this.i++:(n=document.createElement("div"),this.element.appendChild(n),this.i=-1),n.style.cssText=t,n.className=e;},e.prototype.update=function(e){if(!e)return;this.config=e,this.i=0;var t;for(var n in this.markers){var r=this.markers[n];if(!r.range){r.update(t,this,this.session,e);continue}var i=r.range.clipRows(e.firstRow,e.lastRow);if(i.isEmpty())continue;i=i.toScreenRange(this.session);if(r.renderer){var s=this.$getTop(i.start.row,e),o=this.$padding+i.start.column*e.characterWidth;r.renderer(t,i,o,s,e);}else r.type=="fullLine"?this.drawFullLineMarker(t,i,r.clazz,e):r.type=="screenLine"?this.drawScreenLineMarker(t,i,r.clazz,e):i.isMultiLine()?r.type=="text"?this.drawTextMarker(t,i,r.clazz,e):this.drawMultiLineMarker(t,i,r.clazz,e):this.drawSingleLineMarker(t,i,r.clazz+" ace_start"+" ace_br15",e);}if(this.i!=-1)while(this.i<this.element.childElementCount)this.element.removeChild(this.element.lastChild);},e.prototype.$getTop=function(e,t){return (e-t.firstRowScreen)*t.lineHeight},e.prototype.drawTextMarker=function(e,t,n,i,s){var u=this.session,a=t.start.row,f=t.end.row,l=a,c=0,h=0,p=u.getScreenLastRowColumn(l),d=new r(l,t.start.column,l,h);for(;l<=f;l++)d.start.row=d.end.row=l,d.start.column=l==a?t.start.column:u.getRowWrapIndent(l),d.end.column=p,c=h,h=p,p=l+1<f?u.getScreenLastRowColumn(l+1):l==f?0:t.end.column,this.drawSingleLineMarker(e,d,n+(l==a?" ace_start":"")+" ace_br"+o(l==a||l==a+1&&t.start.column,c<h,h>p,l==f),i,l==f?0:1,s);},e.prototype.drawMultiLineMarker=function(e,t,n,r,i){var s=this.$padding,o=r.lineHeight,u=this.$getTop(t.start.row,r),a=s+t.start.column*r.characterWidth;i=i||"";if(this.session.$bidiHandler.isBidiRow(t.start.row)){var f=t.clone();f.end.row=f.start.row,f.end.column=this.session.getLine(f.start.row).length,this.drawBidiSingleLineMarker(e,f,n+" ace_br1 ace_start",r,null,i);}else this.elt(n+" ace_br1 ace_start","height:"+o+"px;"+"right:0;"+"top:"+u+"px;left:"+a+"px;"+(i||""));if(this.session.$bidiHandler.isBidiRow(t.end.row)){var f=t.clone();f.start.row=f.end.row,f.start.column=0,this.drawBidiSingleLineMarker(e,f,n+" ace_br12",r,null,i);}else {u=this.$getTop(t.end.row,r);var l=t.end.column*r.characterWidth;this.elt(n+" ace_br12","height:"+o+"px;"+"width:"+l+"px;"+"top:"+u+"px;"+"left:"+s+"px;"+(i||""));}o=(t.end.row-t.start.row-1)*r.lineHeight;if(o<=0)return;u=this.$getTop(t.start.row+1,r);var c=(t.start.column?1:0)|(t.end.column?0:8);this.elt(n+(c?" ace_br"+c:""),"height:"+o+"px;"+"right:0;"+"top:"+u+"px;"+"left:"+s+"px;"+(i||""));},e.prototype.drawSingleLineMarker=function(e,t,n,r,i,s){if(this.session.$bidiHandler.isBidiRow(t.start.row))return this.drawBidiSingleLineMarker(e,t,n,r,i,s);var o=r.lineHeight,u=(t.end.column+(i||0)-t.start.column)*r.characterWidth,a=this.$getTop(t.start.row,r),f=this.$padding+t.start.column*r.characterWidth;this.elt(n,"height:"+o+"px;"+"width:"+u+"px;"+"top:"+a+"px;"+"left:"+f+"px;"+(s||""));},e.prototype.drawBidiSingleLineMarker=function(e,t,n,r,i,s){var o=r.lineHeight,u=this.$getTop(t.start.row,r),a=this.$padding,f=this.session.$bidiHandler.getSelections(t.start.column,t.end.column);f.forEach(function(e){this.elt(n,"height:"+o+"px;"+"width:"+(e.width+(i||0))+"px;"+"top:"+u+"px;"+"left:"+(a+e.left)+"px;"+(s||""));},this);},e.prototype.drawFullLineMarker=function(e,t,n,r,i){var s=this.$getTop(t.start.row,r),o=r.lineHeight;t.start.row!=t.end.row&&(o+=this.$getTop(t.end.row,r)-s),this.elt(n,"height:"+o+"px;"+"top:"+s+"px;"+"left:0;right:0;"+(i||""));},e.prototype.drawScreenLineMarker=function(e,t,n,r,i){var s=this.$getTop(t.start.row,r),o=r.lineHeight;this.elt(n,"height:"+o+"px;"+"top:"+s+"px;"+"left:0;right:0;"+(i||""));},e}();s.prototype.$padding=0,t.Marker=s;}),ace.define("ace/layer/text_util",["require","exports","module"],function(e,t,n){var r=new Set(["text","rparen","lparen"]);t.isTextToken=function(e){return r.has(e)};}),ace.define("ace/layer/text",["require","exports","module","ace/lib/oop","ace/lib/dom","ace/lib/lang","ace/layer/lines","ace/lib/event_emitter","ace/config","ace/layer/text_util"],function(e,t,n){var r=e("../lib/oop"),i=e("../lib/dom"),s=e("../lib/lang"),o=e("./lines").Lines,u=e("../lib/event_emitter").EventEmitter,a=e("../config").nls,f=e("./text_util").isTextToken,l=function(){function e(e){this.dom=i,this.element=this.dom.createElement("div"),this.element.className="ace_layer ace_text-layer",e.appendChild(this.element),this.$updateEolChar=this.$updateEolChar.bind(this),this.$lines=new o(this.element);}return e.prototype.$updateEolChar=function(){var e=this.session.doc,t=e.getNewLineCharacter()=="\n"&&e.getNewLineMode()!="windows",n=t?this.EOL_CHAR_LF:this.EOL_CHAR_CRLF;if(this.EOL_CHAR!=n)return this.EOL_CHAR=n,!0},e.prototype.setPadding=function(e){this.$padding=e,this.element.style.margin="0 "+e+"px";},e.prototype.getLineHeight=function(){return this.$fontMetrics.$characterSize.height||0},e.prototype.getCharacterWidth=function(){return this.$fontMetrics.$characterSize.width||0},e.prototype.$setFontMetrics=function(e){this.$fontMetrics=e,this.$fontMetrics.on("changeCharacterSize",function(e){this._signal("changeCharacterSize",e);}.bind(this)),this.$pollSizeChanges();},e.prototype.checkForSizeChanges=function(){this.$fontMetrics.checkForSizeChanges();},e.prototype.$pollSizeChanges=function(){return this.$pollSizeChangesTimer=this.$fontMetrics.$pollSizeChanges()},e.prototype.setSession=function(e){this.session=e,e&&this.$computeTabString();},e.prototype.setShowInvisibles=function(e){return this.showInvisibles==e?!1:(this.showInvisibles=e,typeof e=="string"?(this.showSpaces=/tab/i.test(e),this.showTabs=/space/i.test(e),this.showEOL=/eol/i.test(e)):this.showSpaces=this.showTabs=this.showEOL=e,this.$computeTabString(),!0)},e.prototype.setDisplayIndentGuides=function(e){return this.displayIndentGuides==e?!1:(this.displayIndentGuides=e,this.$computeTabString(),!0)},e.prototype.setHighlightIndentGuides=function(e){return this.$highlightIndentGuides===e?!1:(this.$highlightIndentGuides=e,e)},e.prototype.$computeTabString=function(){var e=this.session.getTabSize();this.tabSize=e;var t=this.$tabStrings=[0];for(var n=1;n<e+1;n++)if(this.showTabs){var r=this.dom.createElement("span");r.className="ace_invisible ace_invisible_tab",r.textContent=s.stringRepeat(this.TAB_CHAR,n),t.push(r);}else t.push(this.dom.createTextNode(s.stringRepeat(" ",n),this.element));if(this.displayIndentGuides){this.$indentGuideRe=/\s\S| \t|\t |\s$/;var i="ace_indent-guide",o=this.showSpaces?" ace_invisible ace_invisible_space":"",u=this.showSpaces?s.stringRepeat(this.SPACE_CHAR,this.tabSize):s.stringRepeat(" ",this.tabSize),a=this.showTabs?" ace_invisible ace_invisible_tab":"",f=this.showTabs?s.stringRepeat(this.TAB_CHAR,this.tabSize):u,r=this.dom.createElement("span");r.className=i+o,r.textContent=u,this.$tabStrings[" "]=r;var r=this.dom.createElement("span");r.className=i+a,r.textContent=f,this.$tabStrings["	"]=r;}},e.prototype.updateLines=function(e,t,n){if(this.config.lastRow!=e.lastRow||this.config.firstRow!=e.firstRow)return this.update(e);this.config=e;var r=Math.max(t,e.firstRow),i=Math.min(n,e.lastRow),s=this.element.childNodes,o=0;for(var u=e.firstRow;u<r;u++){var a=this.session.getFoldLine(u);if(a){if(a.containsRow(r)){r=a.start.row;break}u=a.end.row;}o++;}var f=!1,u=r,a=this.session.getNextFoldLine(u),l=a?a.start.row:Infinity;for(;;){u>l&&(u=a.end.row+1,a=this.session.getNextFoldLine(u,a),l=a?a.start.row:Infinity);if(u>i)break;var c=s[o++];if(c){this.dom.removeChildren(c),this.$renderLine(c,u,u==l?a:!1),f&&(c.style.top=this.$lines.computeLineTop(u,e,this.session)+"px");var h=e.lineHeight*this.session.getRowLength(u)+"px";c.style.height!=h&&(f=!0,c.style.height=h);}u++;}if(f)while(o<this.$lines.cells.length){var p=this.$lines.cells[o++];p.element.style.top=this.$lines.computeLineTop(p.row,e,this.session)+"px";}},e.prototype.scrollLines=function(e){var t=this.config;this.config=e;if(this.$lines.pageChanged(t,e))return this.update(e);this.$lines.moveContainer(e);var n=e.lastRow,r=t?t.lastRow:-1;if(!t||r<e.firstRow)return this.update(e);if(n<t.firstRow)return this.update(e);if(!t||t.lastRow<e.firstRow)return this.update(e);if(e.lastRow<t.firstRow)return this.update(e);if(t.firstRow<e.firstRow)for(var i=this.session.getFoldedRowCount(t.firstRow,e.firstRow-1);i>0;i--)this.$lines.shift();if(t.lastRow>e.lastRow)for(var i=this.session.getFoldedRowCount(e.lastRow+1,t.lastRow);i>0;i--)this.$lines.pop();e.firstRow<t.firstRow&&this.$lines.unshift(this.$renderLinesFragment(e,e.firstRow,t.firstRow-1)),e.lastRow>t.lastRow&&this.$lines.push(this.$renderLinesFragment(e,t.lastRow+1,e.lastRow)),this.$highlightIndentGuide();},e.prototype.$renderLinesFragment=function(e,t,n){var r=[],s=t,o=this.session.getNextFoldLine(s),u=o?o.start.row:Infinity;for(;;){s>u&&(s=o.end.row+1,o=this.session.getNextFoldLine(s,o),u=o?o.start.row:Infinity);if(s>n)break;var a=this.$lines.createCell(s,e,this.session),f=a.element;this.dom.removeChildren(f),i.setStyle(f.style,"height",this.$lines.computeLineHeight(s,e,this.session)+"px"),i.setStyle(f.style,"top",this.$lines.computeLineTop(s,e,this.session)+"px"),this.$renderLine(f,s,s==u?o:!1),this.$useLineGroups()?f.className="ace_line_group":f.className="ace_line",r.push(a),s++;}return r},e.prototype.update=function(e){this.$lines.moveContainer(e),this.config=e;var t=e.firstRow,n=e.lastRow,r=this.$lines;while(r.getLength())r.pop();r.push(this.$renderLinesFragment(e,t,n));},e.prototype.$renderToken=function(e,t,n,r){var i=this,o=/(\t)|( +)|([\x00-\x1f\x80-\xa0\xad\u1680\u180E\u2000-\u200f\u2028\u2029\u202F\u205F\uFEFF\uFFF9-\uFFFC\u2066\u2067\u2068\u202A\u202B\u202D\u202E\u202C\u2069]+)|(\u3000)|([\u1100-\u115F\u11A3-\u11A7\u11FA-\u11FF\u2329-\u232A\u2E80-\u2E99\u2E9B-\u2EF3\u2F00-\u2FD5\u2FF0-\u2FFB\u3001-\u303E\u3041-\u3096\u3099-\u30FF\u3105-\u312D\u3131-\u318E\u3190-\u31BA\u31C0-\u31E3\u31F0-\u321E\u3220-\u3247\u3250-\u32FE\u3300-\u4DBF\u4E00-\uA48C\uA490-\uA4C6\uA960-\uA97C\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE52\uFE54-\uFE66\uFE68-\uFE6B\uFF01-\uFF60\uFFE0-\uFFE6]|[\uD800-\uDBFF][\uDC00-\uDFFF])/g,u=this.dom.createFragment(this.element),l,c=0;while(l=o.exec(r)){var h=l[1],p=l[2],d=l[3],v=l[4],m=l[5];if(!i.showSpaces&&p)continue;var g=c!=l.index?r.slice(c,l.index):"";c=l.index+l[0].length,g&&u.appendChild(this.dom.createTextNode(g,this.element));if(h){var y=i.session.getScreenTabSize(t+l.index);u.appendChild(i.$tabStrings[y].cloneNode(!0)),t+=y-1;}else if(p)if(i.showSpaces){var b=this.dom.createElement("span");b.className="ace_invisible ace_invisible_space",b.textContent=s.stringRepeat(i.SPACE_CHAR,p.length),u.appendChild(b);}else u.appendChild(this.dom.createTextNode(p,this.element));else if(d){var b=this.dom.createElement("span");b.className="ace_invisible ace_invisible_space ace_invalid",b.textContent=s.stringRepeat(i.SPACE_CHAR,d.length),u.appendChild(b);}else if(v){t+=1;var b=this.dom.createElement("span");b.style.width=i.config.characterWidth*2+"px",b.className=i.showSpaces?"ace_cjk ace_invisible ace_invisible_space":"ace_cjk",b.textContent=i.showSpaces?i.SPACE_CHAR:v,u.appendChild(b);}else if(m){t+=1;var b=this.dom.createElement("span");b.style.width=i.config.characterWidth*2+"px",b.className="ace_cjk",b.textContent=m,u.appendChild(b);}}u.appendChild(this.dom.createTextNode(c?r.slice(c):r,this.element));if(!f(n.type)){var w="ace_"+n.type.replace(/\./g," ace_"),b=this.dom.createElement("span");n.type=="fold"&&(b.style.width=n.value.length*this.config.characterWidth+"px",b.setAttribute("title",a("Unfold code"))),b.className=w,b.appendChild(u),e.appendChild(b);}else e.appendChild(u);return t+r.length},e.prototype.renderIndentGuide=function(e,t,n){var r=t.search(this.$indentGuideRe);if(r<=0||r>=n)return t;if(t[0]==" "){r-=r%this.tabSize;var i=r/this.tabSize;for(var s=0;s<i;s++)e.appendChild(this.$tabStrings[" "].cloneNode(!0));return this.$highlightIndentGuide(),t.substr(r)}if(t[0]=="	"){for(var s=0;s<r;s++)e.appendChild(this.$tabStrings["	"].cloneNode(!0));return this.$highlightIndentGuide(),t.substr(r)}return this.$highlightIndentGuide(),t},e.prototype.$highlightIndentGuide=function(){if(!this.$highlightIndentGuides||!this.displayIndentGuides)return;this.$highlightIndentGuideMarker={indentLevel:undefined,start:undefined,end:undefined,dir:undefined};var e=this.session.doc.$lines;if(!e)return;var t=this.session.selection.getCursor(),n=/^\s*/.exec(this.session.doc.getLine(t.row))[0].length,r=Math.floor(n/this.tabSize);this.$highlightIndentGuideMarker={indentLevel:r,start:t.row};var i=this.session.$bracketHighlight;if(i){var s=this.session.$bracketHighlight.ranges;for(var o=0;o<s.length;o++)if(t.row!==s[o].start.row){this.$highlightIndentGuideMarker.end=s[o].start.row,t.row>s[o].start.row?this.$highlightIndentGuideMarker.dir=-1:this.$highlightIndentGuideMarker.dir=1;break}}if(!this.$highlightIndentGuideMarker.end&&e[t.row]!==""&&t.column===e[t.row].length){this.$highlightIndentGuideMarker.dir=1;for(var o=t.row+1;o<e.length;o++){var u=e[o],a=/^\s*/.exec(u)[0].length;if(u!==""){this.$highlightIndentGuideMarker.end=o;if(a<=n)break}}}this.$renderHighlightIndentGuide();},e.prototype.$clearActiveIndentGuide=function(){var e=this.$lines.cells;for(var t=0;t<e.length;t++){var n=e[t],r=n.element.childNodes;if(r.length>0)for(var i=0;i<r.length;i++)if(r[i].classList&&r[i].classList.contains("ace_indent-guide-active")){r[i].classList.remove("ace_indent-guide-active");break}}},e.prototype.$setIndentGuideActive=function(e,t){var n=this.session.doc.getLine(e.row);if(n!==""){var r=e.element.childNodes;if(r){var i=r[t-1];i&&i.classList&&i.classList.contains("ace_indent-guide")&&i.classList.add("ace_indent-guide-active");}}},e.prototype.$renderHighlightIndentGuide=function(){if(!this.$lines)return;var e=this.$lines.cells;this.$clearActiveIndentGuide();var t=this.$highlightIndentGuideMarker.indentLevel;if(t!==0)if(this.$highlightIndentGuideMarker.dir===1)for(var n=0;n<e.length;n++){var r=e[n];if(this.$highlightIndentGuideMarker.end&&r.row>=this.$highlightIndentGuideMarker.start+1){if(r.row>=this.$highlightIndentGuideMarker.end)break;this.$setIndentGuideActive(r,t);}}else for(var n=e.length-1;n>=0;n--){var r=e[n];if(this.$highlightIndentGuideMarker.end&&r.row<this.$highlightIndentGuideMarker.start){if(r.row<=this.$highlightIndentGuideMarker.end)break;this.$setIndentGuideActive(r,t);}}},e.prototype.$createLineElement=function(e){var t=this.dom.createElement("div");return t.className="ace_line",t.style.height=this.config.lineHeight+"px",t},e.prototype.$renderWrappedLine=function(e,t,n){var r=0,i=0,o=n[0],u=0,a=this.$createLineElement();e.appendChild(a);for(var f=0;f<t.length;f++){var l=t[f],c=l.value;if(f==0&&this.displayIndentGuides){r=c.length,c=this.renderIndentGuide(a,c,o);if(!c)continue;r-=c.length;}if(r+c.length<o)u=this.$renderToken(a,u,l,c),r+=c.length;else {while(r+c.length>=o)u=this.$renderToken(a,u,l,c.substring(0,o-r)),c=c.substring(o-r),r=o,a=this.$createLineElement(),e.appendChild(a),a.appendChild(this.dom.createTextNode(s.stringRepeat("\u00a0",n.indent),this.element)),i++,u=0,o=n[i]||Number.MAX_VALUE;c.length!=0&&(r+=c.length,u=this.$renderToken(a,u,l,c));}}n[n.length-1]>this.MAX_LINE_LENGTH&&this.$renderOverflowMessage(a,u,null,"",!0);},e.prototype.$renderSimpleLine=function(e,t){var n=0;for(var r=0;r<t.length;r++){var i=t[r],s=i.value;if(r==0&&this.displayIndentGuides){s=this.renderIndentGuide(e,s);if(!s)continue}if(n+s.length>this.MAX_LINE_LENGTH)return this.$renderOverflowMessage(e,n,i,s);n=this.$renderToken(e,n,i,s);}},e.prototype.$renderOverflowMessage=function(e,t,n,r,i){n&&this.$renderToken(e,t,n,r.slice(0,this.MAX_LINE_LENGTH-t));var s=this.dom.createElement("span");s.className="ace_inline_button ace_keyword ace_toggle_wrap",s.textContent=i?"<hide>":"<click to see more...>",e.appendChild(s);},e.prototype.$renderLine=function(e,t,n){!n&&n!=0&&(n=this.session.getFoldLine(t));if(n)var r=this.$getFoldLineTokens(t,n);else var r=this.session.getTokens(t);var i=e;if(r.length){var s=this.session.getRowSplitData(t);if(s&&s.length){this.$renderWrappedLine(e,r,s);var i=e.lastChild;}else {var i=e;this.$useLineGroups()&&(i=this.$createLineElement(),e.appendChild(i)),this.$renderSimpleLine(i,r);}}else this.$useLineGroups()&&(i=this.$createLineElement(),e.appendChild(i));if(this.showEOL&&i){n&&(t=n.end.row);var o=this.dom.createElement("span");o.className="ace_invisible ace_invisible_eol",o.textContent=t==this.session.getLength()-1?this.EOF_CHAR:this.EOL_CHAR,i.appendChild(o);}},e.prototype.$getFoldLineTokens=function(e,t){function i(e,t,n){var i=0,s=0;while(s+e[i].value.length<t){s+=e[i].value.length,i++;if(i==e.length)return}if(s!=t){var o=e[i].value.substring(t-s);o.length>n-t&&(o=o.substring(0,n-t)),r.push({type:e[i].type,value:o}),s=t+o.length,i+=1;}while(s<n&&i<e.length){var o=e[i].value;o.length+s>n?r.push({type:e[i].type,value:o.substring(0,n-s)}):r.push(e[i]),s+=o.length,i+=1;}}var n=this.session,r=[],s=n.getTokens(e);return t.walk(function(e,t,o,u,a){e!=null?r.push({type:"fold",value:e}):(a&&(s=n.getTokens(t)),s.length&&i(s,u,o));},t.end.row,this.session.getLine(t.end.row).length),r},e.prototype.$useLineGroups=function(){return this.session.getUseWrapMode()},e}();l.prototype.EOF_CHAR="\u00b6",l.prototype.EOL_CHAR_LF="\u00ac",l.prototype.EOL_CHAR_CRLF="\u00a4",l.prototype.EOL_CHAR=l.prototype.EOL_CHAR_LF,l.prototype.TAB_CHAR="\u2014",l.prototype.SPACE_CHAR="\u00b7",l.prototype.$padding=0,l.prototype.MAX_LINE_LENGTH=1e4,l.prototype.showInvisibles=!1,l.prototype.showSpaces=!1,l.prototype.showTabs=!1,l.prototype.showEOL=!1,l.prototype.displayIndentGuides=!0,l.prototype.$highlightIndentGuides=!0,l.prototype.$tabStrings=[],l.prototype.destroy={},l.prototype.onChangeTabSize=l.prototype.$computeTabString,r.implement(l.prototype,u),t.Text=l;}),ace.define("ace/layer/cursor",["require","exports","module","ace/lib/dom"],function(e,t,n){var r=e("../lib/dom"),i=function(){function e(e){this.element=r.createElement("div"),this.element.className="ace_layer ace_cursor-layer",e.appendChild(this.element),this.isVisible=!1,this.isBlinking=!0,this.blinkInterval=1e3,this.smoothBlinking=!1,this.cursors=[],this.cursor=this.addCursor(),r.addCssClass(this.element,"ace_hidden-cursors"),this.$updateCursors=this.$updateOpacity.bind(this);}return e.prototype.$updateOpacity=function(e){var t=this.cursors;for(var n=t.length;n--;)r.setStyle(t[n].style,"opacity",e?"":"0");},e.prototype.$startCssAnimation=function(){var e=this.cursors;for(var t=e.length;t--;)e[t].style.animationDuration=this.blinkInterval+"ms";this.$isAnimating=!0,setTimeout(function(){this.$isAnimating&&r.addCssClass(this.element,"ace_animate-blinking");}.bind(this));},e.prototype.$stopCssAnimation=function(){this.$isAnimating=!1,r.removeCssClass(this.element,"ace_animate-blinking");},e.prototype.setPadding=function(e){this.$padding=e;},e.prototype.setSession=function(e){this.session=e;},e.prototype.setBlinking=function(e){e!=this.isBlinking&&(this.isBlinking=e,this.restartTimer());},e.prototype.setBlinkInterval=function(e){e!=this.blinkInterval&&(this.blinkInterval=e,this.restartTimer());},e.prototype.setSmoothBlinking=function(e){e!=this.smoothBlinking&&(this.smoothBlinking=e,r.setCssClass(this.element,"ace_smooth-blinking",e),this.$updateCursors(!0),this.restartTimer());},e.prototype.addCursor=function(){var e=r.createElement("div");return e.className="ace_cursor",this.element.appendChild(e),this.cursors.push(e),e},e.prototype.removeCursor=function(){if(this.cursors.length>1){var e=this.cursors.pop();return e.parentNode.removeChild(e),e}},e.prototype.hideCursor=function(){this.isVisible=!1,r.addCssClass(this.element,"ace_hidden-cursors"),this.restartTimer();},e.prototype.showCursor=function(){this.isVisible=!0,r.removeCssClass(this.element,"ace_hidden-cursors"),this.restartTimer();},e.prototype.restartTimer=function(){var e=this.$updateCursors;clearInterval(this.intervalId),clearTimeout(this.timeoutId),this.$stopCssAnimation(),this.smoothBlinking&&(this.$isSmoothBlinking=!1,r.removeCssClass(this.element,"ace_smooth-blinking")),e(!0);if(!this.isBlinking||!this.blinkInterval||!this.isVisible){this.$stopCssAnimation();return}this.smoothBlinking&&(this.$isSmoothBlinking=!0,setTimeout(function(){this.$isSmoothBlinking&&r.addCssClass(this.element,"ace_smooth-blinking");}.bind(this)));if(r.HAS_CSS_ANIMATION)this.$startCssAnimation();else {var t=function(){this.timeoutId=setTimeout(function(){e(!1);},.6*this.blinkInterval);}.bind(this);this.intervalId=setInterval(function(){e(!0),t();},this.blinkInterval),t();}},e.prototype.getPixelPosition=function(e,t){if(!this.config||!this.session)return {left:0,top:0};e||(e=this.session.selection.getCursor());var n=this.session.documentToScreenPosition(e),r=this.$padding+(this.session.$bidiHandler.isBidiRow(n.row,e.row)?this.session.$bidiHandler.getPosLeft(n.column):n.column*this.config.characterWidth),i=(n.row-(t?this.config.firstRowScreen:0))*this.config.lineHeight;return {left:r,top:i}},e.prototype.isCursorInView=function(e,t){return e.top>=0&&e.top<t.maxHeight},e.prototype.update=function(e){this.config=e;var t=this.session.$selectionMarkers,n=0,i=0;if(t===undefined||t.length===0)t=[{cursor:null}];for(var n=0,s=t.length;n<s;n++){var o=this.getPixelPosition(t[n].cursor,!0);if((o.top>e.height+e.offset||o.top<0)&&n>1)continue;var u=this.cursors[i++]||this.addCursor(),a=u.style;this.drawCursor?this.drawCursor(u,o,e,t[n],this.session):this.isCursorInView(o,e)?(r.setStyle(a,"display","block"),r.translate(u,o.left,o.top),r.setStyle(a,"width",Math.round(e.characterWidth)+"px"),r.setStyle(a,"height",e.lineHeight+"px")):r.setStyle(a,"display","none");}while(this.cursors.length>i)this.removeCursor();var f=this.session.getOverwrite();this.$setOverwrite(f),this.$pixelPos=o,this.restartTimer();},e.prototype.$setOverwrite=function(e){e!=this.overwrite&&(this.overwrite=e,e?r.addCssClass(this.element,"ace_overwrite-cursors"):r.removeCssClass(this.element,"ace_overwrite-cursors"));},e.prototype.destroy=function(){clearInterval(this.intervalId),clearTimeout(this.timeoutId);},e}();i.prototype.$padding=0,i.prototype.drawCursor=null,t.Cursor=i;}),ace.define("ace/scrollbar",["require","exports","module","ace/lib/oop","ace/lib/dom","ace/lib/event","ace/lib/event_emitter"],function(e,t,n){var r=this&&this.__extends||function(){var e=function(t,n){return e=Object.setPrototypeOf||{__proto__:[]}instanceof Array&&function(e,t){e.__proto__=t;}||function(e,t){for(var n in t)Object.prototype.hasOwnProperty.call(t,n)&&(e[n]=t[n]);},e(t,n)};return function(t,n){function r(){this.constructor=t;}if(typeof n!="function"&&n!==null)throw new TypeError("Class extends value "+String(n)+" is not a constructor or null");e(t,n),t.prototype=n===null?Object.create(n):(r.prototype=n.prototype,new r);}}(),i=e("./lib/oop"),s=e("./lib/dom"),o=e("./lib/event"),u=e("./lib/event_emitter").EventEmitter,a=32768,f=function(){function e(e,t){this.element=s.createElement("div"),this.element.className="ace_scrollbar ace_scrollbar"+t,this.inner=s.createElement("div"),this.inner.className="ace_scrollbar-inner",this.inner.textContent="\u00a0",this.element.appendChild(this.inner),e.appendChild(this.element),this.setVisible(!1),this.skipEvent=!1,o.addListener(this.element,"scroll",this.onScroll.bind(this)),o.addListener(this.element,"mousedown",o.preventDefault);}return e.prototype.setVisible=function(e){this.element.style.display=e?"":"none",this.isVisible=e,this.coeff=1;},e}();i.implement(f.prototype,u);var l=function(e){function t(t,n){var r=e.call(this,t,"-v")||this;return r.scrollTop=0,r.scrollHeight=0,n.$scrollbarWidth=r.width=s.scrollbarWidth(t.ownerDocument),r.inner.style.width=r.element.style.width=(r.width||15)+5+"px",r.$minWidth=0,r}return r(t,e),t.prototype.onScroll=function(){if(!this.skipEvent){this.scrollTop=this.element.scrollTop;if(this.coeff!=1){var e=this.element.clientHeight/this.scrollHeight;this.scrollTop=this.scrollTop*(1-e)/(this.coeff-e);}this._emit("scroll",{data:this.scrollTop});}this.skipEvent=!1;},t.prototype.getWidth=function(){return Math.max(this.isVisible?this.width:0,this.$minWidth||0)},t.prototype.setHeight=function(e){this.element.style.height=e+"px";},t.prototype.setScrollHeight=function(e){this.scrollHeight=e,e>a?(this.coeff=a/e,e=a):this.coeff!=1&&(this.coeff=1),this.inner.style.height=e+"px";},t.prototype.setScrollTop=function(e){this.scrollTop!=e&&(this.skipEvent=!0,this.scrollTop=e,this.element.scrollTop=e*this.coeff);},t}(f);l.prototype.setInnerHeight=l.prototype.setScrollHeight;var c=function(e){function t(t,n){var r=e.call(this,t,"-h")||this;return r.scrollLeft=0,r.height=n.$scrollbarWidth,r.inner.style.height=r.element.style.height=(r.height||15)+5+"px",r}return r(t,e),t.prototype.onScroll=function(){this.skipEvent||(this.scrollLeft=this.element.scrollLeft,this._emit("scroll",{data:this.scrollLeft})),this.skipEvent=!1;},t.prototype.getHeight=function(){return this.isVisible?this.height:0},t.prototype.setWidth=function(e){this.element.style.width=e+"px";},t.prototype.setInnerWidth=function(e){this.inner.style.width=e+"px";},t.prototype.setScrollWidth=function(e){this.inner.style.width=e+"px";},t.prototype.setScrollLeft=function(e){this.scrollLeft!=e&&(this.skipEvent=!0,this.scrollLeft=this.element.scrollLeft=e);},t}(f);t.ScrollBar=l,t.ScrollBarV=l,t.ScrollBarH=c,t.VScrollBar=l,t.HScrollBar=c;}),ace.define("ace/scrollbar_custom",["require","exports","module","ace/lib/oop","ace/lib/dom","ace/lib/event","ace/lib/event_emitter"],function(e,t,n){var r=this&&this.__extends||function(){var e=function(t,n){return e=Object.setPrototypeOf||{__proto__:[]}instanceof Array&&function(e,t){e.__proto__=t;}||function(e,t){for(var n in t)Object.prototype.hasOwnProperty.call(t,n)&&(e[n]=t[n]);},e(t,n)};return function(t,n){function r(){this.constructor=t;}if(typeof n!="function"&&n!==null)throw new TypeError("Class extends value "+String(n)+" is not a constructor or null");e(t,n),t.prototype=n===null?Object.create(n):(r.prototype=n.prototype,new r);}}(),i=e("./lib/oop"),s=e("./lib/dom"),o=e("./lib/event"),u=e("./lib/event_emitter").EventEmitter;s.importCssString(".ace_editor>.ace_sb-v div, .ace_editor>.ace_sb-h div{\n  position: absolute;\n  background: rgba(128, 128, 128, 0.6);\n  -moz-box-sizing: border-box;\n  box-sizing: border-box;\n  border: 1px solid #bbb;\n  border-radius: 2px;\n  z-index: 8;\n}\n.ace_editor>.ace_sb-v, .ace_editor>.ace_sb-h {\n  position: absolute;\n  z-index: 6;\n  background: none;\n  overflow: hidden!important;\n}\n.ace_editor>.ace_sb-v {\n  z-index: 6;\n  right: 0;\n  top: 0;\n  width: 12px;\n}\n.ace_editor>.ace_sb-v div {\n  z-index: 8;\n  right: 0;\n  width: 100%;\n}\n.ace_editor>.ace_sb-h {\n  bottom: 0;\n  left: 0;\n  height: 12px;\n}\n.ace_editor>.ace_sb-h div {\n  bottom: 0;\n  height: 100%;\n}\n.ace_editor>.ace_sb_grabbed {\n  z-index: 8;\n  background: #000;\n}","ace_scrollbar.css",!1);var a=function(){function e(e,t){this.element=s.createElement("div"),this.element.className="ace_sb"+t,this.inner=s.createElement("div"),this.inner.className="",this.element.appendChild(this.inner),this.VScrollWidth=12,this.HScrollHeight=12,e.appendChild(this.element),this.setVisible(!1),this.skipEvent=!1,o.addMultiMouseDownListener(this.element,[500,300,300],this,"onMouseDown");}return e.prototype.setVisible=function(e){this.element.style.display=e?"":"none",this.isVisible=e,this.coeff=1;},e}();i.implement(a.prototype,u);var f=function(e){function t(t,n){var r=e.call(this,t,"-v")||this;return r.scrollTop=0,r.scrollHeight=0,r.parent=t,r.width=r.VScrollWidth,r.renderer=n,r.inner.style.width=r.element.style.width=(r.width||15)+"px",r.$minWidth=0,r}return r(t,e),t.prototype.onMouseDown=function(e,t){if(e!=="mousedown")return;if(o.getButton(t)!==0||t.detail===2)return;if(t.target===this.inner){var n=this,r=t.clientY,i=function(e){r=e.clientY;},s=function(){clearInterval(l);},u=t.clientY,a=this.thumbTop,f=function(){if(r===undefined)return;var e=n.scrollTopFromThumbTop(a+r-u);if(e===n.scrollTop)return;n._emit("scroll",{data:e});};o.capture(this.inner,i,s);var l=setInterval(f,20);return o.preventDefault(t)}var c=t.clientY-this.element.getBoundingClientRect().top-this.thumbHeight/2;return this._emit("scroll",{data:this.scrollTopFromThumbTop(c)}),o.preventDefault(t)},t.prototype.getHeight=function(){return this.height},t.prototype.scrollTopFromThumbTop=function(e){var t=e*(this.pageHeight-this.viewHeight)/(this.slideHeight-this.thumbHeight);return t>>=0,t<0?t=0:t>this.pageHeight-this.viewHeight&&(t=this.pageHeight-this.viewHeight),t},t.prototype.getWidth=function(){return Math.max(this.isVisible?this.width:0,this.$minWidth||0)},t.prototype.setHeight=function(e){this.height=Math.max(0,e),this.slideHeight=this.height,this.viewHeight=this.height,this.setScrollHeight(this.pageHeight,!0);},t.prototype.setScrollHeight=function(e,t){if(this.pageHeight===e&&!t)return;this.pageHeight=e,this.thumbHeight=this.slideHeight*this.viewHeight/this.pageHeight,this.thumbHeight>this.slideHeight&&(this.thumbHeight=this.slideHeight),this.thumbHeight<15&&(this.thumbHeight=15),this.inner.style.height=this.thumbHeight+"px",this.scrollTop>this.pageHeight-this.viewHeight&&(this.scrollTop=this.pageHeight-this.viewHeight,this.scrollTop<0&&(this.scrollTop=0),this._emit("scroll",{data:this.scrollTop}));},t.prototype.setScrollTop=function(e){this.scrollTop=e,e<0&&(e=0),this.thumbTop=e*(this.slideHeight-this.thumbHeight)/(this.pageHeight-this.viewHeight),this.inner.style.top=this.thumbTop+"px";},t}(a);f.prototype.setInnerHeight=f.prototype.setScrollHeight;var l=function(e){function t(t,n){var r=e.call(this,t,"-h")||this;return r.scrollLeft=0,r.scrollWidth=0,r.height=r.HScrollHeight,r.inner.style.height=r.element.style.height=(r.height||12)+"px",r.renderer=n,r}return r(t,e),t.prototype.onMouseDown=function(e,t){if(e!=="mousedown")return;if(o.getButton(t)!==0||t.detail===2)return;if(t.target===this.inner){var n=this,r=t.clientX,i=function(e){r=e.clientX;},s=function(){clearInterval(l);},u=t.clientX,a=this.thumbLeft,f=function(){if(r===undefined)return;var e=n.scrollLeftFromThumbLeft(a+r-u);if(e===n.scrollLeft)return;n._emit("scroll",{data:e});};o.capture(this.inner,i,s);var l=setInterval(f,20);return o.preventDefault(t)}var c=t.clientX-this.element.getBoundingClientRect().left-this.thumbWidth/2;return this._emit("scroll",{data:this.scrollLeftFromThumbLeft(c)}),o.preventDefault(t)},t.prototype.getHeight=function(){return this.isVisible?this.height:0},t.prototype.scrollLeftFromThumbLeft=function(e){var t=e*(this.pageWidth-this.viewWidth)/(this.slideWidth-this.thumbWidth);return t>>=0,t<0?t=0:t>this.pageWidth-this.viewWidth&&(t=this.pageWidth-this.viewWidth),t},t.prototype.setWidth=function(e){this.width=Math.max(0,e),this.element.style.width=this.width+"px",this.slideWidth=this.width,this.viewWidth=this.width,this.setScrollWidth(this.pageWidth,!0);},t.prototype.setScrollWidth=function(e,t){if(this.pageWidth===e&&!t)return;this.pageWidth=e,this.thumbWidth=this.slideWidth*this.viewWidth/this.pageWidth,this.thumbWidth>this.slideWidth&&(this.thumbWidth=this.slideWidth),this.thumbWidth<15&&(this.thumbWidth=15),this.inner.style.width=this.thumbWidth+"px",this.scrollLeft>this.pageWidth-this.viewWidth&&(this.scrollLeft=this.pageWidth-this.viewWidth,this.scrollLeft<0&&(this.scrollLeft=0),this._emit("scroll",{data:this.scrollLeft}));},t.prototype.setScrollLeft=function(e){this.scrollLeft=e,e<0&&(e=0),this.thumbLeft=e*(this.slideWidth-this.thumbWidth)/(this.pageWidth-this.viewWidth),this.inner.style.left=this.thumbLeft+"px";},t}(a);l.prototype.setInnerWidth=l.prototype.setScrollWidth,t.ScrollBar=f,t.ScrollBarV=f,t.ScrollBarH=l,t.VScrollBar=f,t.HScrollBar=l;}),ace.define("ace/renderloop",["require","exports","module","ace/lib/event"],function(e,t,n){var r=e("./lib/event"),i=function(){function e(e,t){this.onRender=e,this.pending=!1,this.changes=0,this.$recursionLimit=2,this.window=t||window;var n=this;this._flush=function(e){n.pending=!1;var t=n.changes;t&&(r.blockIdle(100),n.changes=0,n.onRender(t));if(n.changes){if(n.$recursionLimit--<0)return;n.schedule();}else n.$recursionLimit=2;};}return e.prototype.schedule=function(e){this.changes=this.changes|e,this.changes&&!this.pending&&(r.nextFrame(this._flush),this.pending=!0);},e.prototype.clear=function(e){var t=this.changes;return this.changes=0,t},e}();t.RenderLoop=i;}),ace.define("ace/layer/font_metrics",["require","exports","module","ace/lib/oop","ace/lib/dom","ace/lib/lang","ace/lib/event","ace/lib/useragent","ace/lib/event_emitter"],function(e,t,n){var r=e("../lib/oop"),i=e("../lib/dom"),s=e("../lib/lang"),o=e("../lib/event"),u=e("../lib/useragent"),a=e("../lib/event_emitter").EventEmitter,f=512,l=typeof ResizeObserver=="function",c=200,h=function(){function e(e){this.el=i.createElement("div"),this.$setMeasureNodeStyles(this.el.style,!0),this.$main=i.createElement("div"),this.$setMeasureNodeStyles(this.$main.style),this.$measureNode=i.createElement("div"),this.$setMeasureNodeStyles(this.$measureNode.style),this.el.appendChild(this.$main),this.el.appendChild(this.$measureNode),e.appendChild(this.el),this.$measureNode.textContent=s.stringRepeat("X",f),this.$characterSize={width:0,height:0},l?this.$addObserver():this.checkForSizeChanges();}return e.prototype.$setMeasureNodeStyles=function(e,t){e.width=e.height="auto",e.left=e.top="0px",e.visibility="hidden",e.position="absolute",e.whiteSpace="pre",u.isIE<8?e["font-family"]="inherit":e.font="inherit",e.overflow=t?"hidden":"visible";},e.prototype.checkForSizeChanges=function(e){e===undefined&&(e=this.$measureSizes());if(e&&(this.$characterSize.width!==e.width||this.$characterSize.height!==e.height)){this.$measureNode.style.fontWeight="bold";var t=this.$measureSizes();this.$measureNode.style.fontWeight="",this.$characterSize=e,this.charSizes=Object.create(null),this.allowBoldFonts=t&&t.width===e.width&&t.height===e.height,this._emit("changeCharacterSize",{data:e});}},e.prototype.$addObserver=function(){var e=this;this.$observer=new window.ResizeObserver(function(t){e.checkForSizeChanges();}),this.$observer.observe(this.$measureNode);},e.prototype.$pollSizeChanges=function(){if(this.$pollSizeChangesTimer||this.$observer)return this.$pollSizeChangesTimer;var e=this;return this.$pollSizeChangesTimer=o.onIdle(function t(){e.checkForSizeChanges(),o.onIdle(t,500);},500)},e.prototype.setPolling=function(e){e?this.$pollSizeChanges():this.$pollSizeChangesTimer&&(clearInterval(this.$pollSizeChangesTimer),this.$pollSizeChangesTimer=0);},e.prototype.$measureSizes=function(e){var t={height:(e||this.$measureNode).clientHeight,width:(e||this.$measureNode).clientWidth/f};return t.width===0||t.height===0?null:t},e.prototype.$measureCharWidth=function(e){this.$main.textContent=s.stringRepeat(e,f);var t=this.$main.getBoundingClientRect();return t.width/f},e.prototype.getCharacterWidth=function(e){var t=this.charSizes[e];return t===undefined&&(t=this.charSizes[e]=this.$measureCharWidth(e)/this.$characterSize.width),t},e.prototype.destroy=function(){clearInterval(this.$pollSizeChangesTimer),this.$observer&&this.$observer.disconnect(),this.el&&this.el.parentNode&&this.el.parentNode.removeChild(this.el);},e.prototype.$getZoom=function(e){return !e||!e.parentElement?1:(window.getComputedStyle(e).zoom||1)*this.$getZoom(e.parentElement)},e.prototype.$initTransformMeasureNodes=function(){var e=function(e,t){return ["div",{style:"position: absolute;top:"+e+"px;left:"+t+"px;"}]};this.els=i.buildDom([e(0,0),e(c,0),e(0,c),e(c,c)],this.el);},e.prototype.transformCoordinates=function(e,t){function r(e,t,n){var r=e[1]*t[0]-e[0]*t[1];return [(-t[1]*n[0]+t[0]*n[1])/r,(+e[1]*n[0]-e[0]*n[1])/r]}function i(e,t){return [e[0]-t[0],e[1]-t[1]]}function s(e,t){return [e[0]+t[0],e[1]+t[1]]}function o(e,t){return [e*t[0],e*t[1]]}function u(e){var t=e.getBoundingClientRect();return [t.left,t.top]}if(e){var n=this.$getZoom(this.el);e=o(1/n,e);}this.els||this.$initTransformMeasureNodes();var a=u(this.els[0]),f=u(this.els[1]),l=u(this.els[2]),h=u(this.els[3]),p=r(i(h,f),i(h,l),i(s(f,l),s(h,a))),d=o(1+p[0],i(f,a)),v=o(1+p[1],i(l,a));if(t){var m=t,g=p[0]*m[0]/c+p[1]*m[1]/c+1,y=s(o(m[0],d),o(m[1],v));return s(o(1/g/c,y),a)}var b=i(e,a),w=r(i(d,o(p[0],b)),i(v,o(p[1],b)),b);return o(c,w)},e}();h.prototype.$characterSize={width:0,height:0},r.implement(h.prototype,a),t.FontMetrics=h;}),ace.define("ace/css/editor-css",["require","exports","module"],function(e,t,n){n.exports='\n.ace_br1 {border-top-left-radius    : 3px;}\n.ace_br2 {border-top-right-radius   : 3px;}\n.ace_br3 {border-top-left-radius    : 3px; border-top-right-radius:    3px;}\n.ace_br4 {border-bottom-right-radius: 3px;}\n.ace_br5 {border-top-left-radius    : 3px; border-bottom-right-radius: 3px;}\n.ace_br6 {border-top-right-radius   : 3px; border-bottom-right-radius: 3px;}\n.ace_br7 {border-top-left-radius    : 3px; border-top-right-radius:    3px; border-bottom-right-radius: 3px;}\n.ace_br8 {border-bottom-left-radius : 3px;}\n.ace_br9 {border-top-left-radius    : 3px; border-bottom-left-radius:  3px;}\n.ace_br10{border-top-right-radius   : 3px; border-bottom-left-radius:  3px;}\n.ace_br11{border-top-left-radius    : 3px; border-top-right-radius:    3px; border-bottom-left-radius:  3px;}\n.ace_br12{border-bottom-right-radius: 3px; border-bottom-left-radius:  3px;}\n.ace_br13{border-top-left-radius    : 3px; border-bottom-right-radius: 3px; border-bottom-left-radius:  3px;}\n.ace_br14{border-top-right-radius   : 3px; border-bottom-right-radius: 3px; border-bottom-left-radius:  3px;}\n.ace_br15{border-top-left-radius    : 3px; border-top-right-radius:    3px; border-bottom-right-radius: 3px; border-bottom-left-radius: 3px;}\n\n\n.ace_editor {\n    position: relative;\n    overflow: hidden;\n    padding: 0;\n    font: 12px/normal \'Monaco\', \'Menlo\', \'Ubuntu Mono\', \'Consolas\', \'Source Code Pro\', \'source-code-pro\', monospace;\n    direction: ltr;\n    text-align: left;\n    -webkit-tap-highlight-color: rgba(0, 0, 0, 0);\n}\n\n.ace_scroller {\n    position: absolute;\n    overflow: hidden;\n    top: 0;\n    bottom: 0;\n    background-color: inherit;\n    -ms-user-select: none;\n    -moz-user-select: none;\n    -webkit-user-select: none;\n    user-select: none;\n    cursor: text;\n}\n\n.ace_content {\n    position: absolute;\n    box-sizing: border-box;\n    min-width: 100%;\n    contain: style size layout;\n    font-variant-ligatures: no-common-ligatures;\n}\n\n.ace_keyboard-focus:focus {\n    box-shadow: inset 0 0 0 2px #5E9ED6;\n    outline: none;\n}\n\n.ace_dragging .ace_scroller:before{\n    position: absolute;\n    top: 0;\n    left: 0;\n    right: 0;\n    bottom: 0;\n    content: \'\';\n    background: rgba(250, 250, 250, 0.01);\n    z-index: 1000;\n}\n.ace_dragging.ace_dark .ace_scroller:before{\n    background: rgba(0, 0, 0, 0.01);\n}\n\n.ace_gutter {\n    position: absolute;\n    overflow : hidden;\n    width: auto;\n    top: 0;\n    bottom: 0;\n    left: 0;\n    cursor: default;\n    z-index: 4;\n    -ms-user-select: none;\n    -moz-user-select: none;\n    -webkit-user-select: none;\n    user-select: none;\n    contain: style size layout;\n}\n\n.ace_gutter-active-line {\n    position: absolute;\n    left: 0;\n    right: 0;\n}\n\n.ace_scroller.ace_scroll-left:after {\n    content: "";\n    position: absolute;\n    top: 0;\n    right: 0;\n    bottom: 0;\n    left: 0;\n    box-shadow: 17px 0 16px -16px rgba(0, 0, 0, 0.4) inset;\n    pointer-events: none;\n}\n\n.ace_gutter-cell, .ace_gutter-cell_svg-icons {\n    position: absolute;\n    top: 0;\n    left: 0;\n    right: 0;\n    padding-left: 19px;\n    padding-right: 6px;\n    background-repeat: no-repeat;\n}\n\n.ace_gutter-cell_svg-icons .ace_gutter_annotation {\n    margin-left: -14px;\n    float: left;\n}\n\n.ace_gutter-cell .ace_gutter_annotation {\n    margin-left: -19px;\n    float: left;\n}\n\n.ace_gutter-cell.ace_error, .ace_icon.ace_error, .ace_icon.ace_error_fold {\n    background-image: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAMAAAAoLQ9TAAABOFBMVEX/////////QRswFAb/Ui4wFAYwFAYwFAaWGAfDRymzOSH/PxswFAb/SiUwFAYwFAbUPRvjQiDllog5HhHdRybsTi3/Tyv9Tir+Syj/UC3////XurebMBIwFAb/RSHbPx/gUzfdwL3kzMivKBAwFAbbvbnhPx66NhowFAYwFAaZJg8wFAaxKBDZurf/RB6mMxb/SCMwFAYwFAbxQB3+RB4wFAb/Qhy4Oh+4QifbNRcwFAYwFAYwFAb/QRzdNhgwFAYwFAbav7v/Uy7oaE68MBK5LxLewr/r2NXewLswFAaxJw4wFAbkPRy2PyYwFAaxKhLm1tMwFAazPiQwFAaUGAb/QBrfOx3bvrv/VC/maE4wFAbRPBq6MRO8Qynew8Dp2tjfwb0wFAbx6eju5+by6uns4uH9/f36+vr/GkHjAAAAYnRSTlMAGt+64rnWu/bo8eAA4InH3+DwoN7j4eLi4xP99Nfg4+b+/u9B/eDs1MD1mO7+4PHg2MXa347g7vDizMLN4eG+Pv7i5evs/v79yu7S3/DV7/498Yv24eH+4ufQ3Ozu/v7+y13sRqwAAADLSURBVHjaZc/XDsFgGIBhtDrshlitmk2IrbHFqL2pvXf/+78DPokj7+Fz9qpU/9UXJIlhmPaTaQ6QPaz0mm+5gwkgovcV6GZzd5JtCQwgsxoHOvJO15kleRLAnMgHFIESUEPmawB9ngmelTtipwwfASilxOLyiV5UVUyVAfbG0cCPHig+GBkzAENHS0AstVF6bacZIOzgLmxsHbt2OecNgJC83JERmePUYq8ARGkJx6XtFsdddBQgZE2nPR6CICZhawjA4Fb/chv+399kfR+MMMDGOQAAAABJRU5ErkJggg==");\n    background-repeat: no-repeat;\n    background-position: 2px center;\n}\n\n.ace_gutter-cell.ace_warning, .ace_icon.ace_warning, .ace_icon.ace_warning_fold {\n    background-image: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAMAAAAoLQ9TAAAAmVBMVEX///8AAAD///8AAAAAAABPSzb/5sAAAAB/blH/73z/ulkAAAAAAAD85pkAAAAAAAACAgP/vGz/rkDerGbGrV7/pkQICAf////e0IsAAAD/oED/qTvhrnUAAAD/yHD/njcAAADuv2r/nz//oTj/p064oGf/zHAAAAA9Nir/tFIAAAD/tlTiuWf/tkIAAACynXEAAAAAAAAtIRW7zBpBAAAAM3RSTlMAABR1m7RXO8Ln31Z36zT+neXe5OzooRDfn+TZ4p3h2hTf4t3k3ucyrN1K5+Xaks52Sfs9CXgrAAAAjklEQVR42o3PbQ+CIBQFYEwboPhSYgoYunIqqLn6/z8uYdH8Vmdnu9vz4WwXgN/xTPRD2+sgOcZjsge/whXZgUaYYvT8QnuJaUrjrHUQreGczuEafQCO/SJTufTbroWsPgsllVhq3wJEk2jUSzX3CUEDJC84707djRc5MTAQxoLgupWRwW6UB5fS++NV8AbOZgnsC7BpEAAAAABJRU5ErkJggg==");\n    background-repeat: no-repeat;\n    background-position: 2px center;\n}\n\n.ace_gutter-cell.ace_info, .ace_icon.ace_info {\n    background-image: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAAAAAA6mKC9AAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAAJ0Uk5TAAB2k804AAAAPklEQVQY02NgIB68QuO3tiLznjAwpKTgNyDbMegwisCHZUETUZV0ZqOquBpXj2rtnpSJT1AEnnRmL2OgGgAAIKkRQap2htgAAAAASUVORK5CYII=");\n    background-repeat: no-repeat;\n    background-position: 2px center;\n}\n.ace_dark .ace_gutter-cell.ace_info, .ace_dark .ace_icon.ace_info {\n    background-image: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQBAMAAADt3eJSAAAAJFBMVEUAAAChoaGAgIAqKiq+vr6tra1ZWVmUlJSbm5s8PDxubm56enrdgzg3AAAAAXRSTlMAQObYZgAAAClJREFUeNpjYMAPdsMYHegyJZFQBlsUlMFVCWUYKkAZMxZAGdxlDMQBAG+TBP4B6RyJAAAAAElFTkSuQmCC");\n}\n\n.ace_icon_svg.ace_error {\n    -webkit-mask-image: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMCAxNiI+CjxnIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlPSJyZWQiIHNoYXBlLXJlbmRlcmluZz0iZ2VvbWV0cmljUHJlY2lzaW9uIj4KPGNpcmNsZSBmaWxsPSJub25lIiBjeD0iOCIgY3k9IjgiIHI9IjciIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz4KPGxpbmUgeDE9IjExIiB5MT0iNSIgeDI9IjUiIHkyPSIxMSIvPgo8bGluZSB4MT0iMTEiIHkxPSIxMSIgeDI9IjUiIHkyPSI1Ii8+CjwvZz4KPC9zdmc+");\n    background-color: crimson;\n}\n.ace_icon_svg.ace_warning {\n    -webkit-mask-image: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMCAxNiI+CjxnIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlPSJkYXJrb3JhbmdlIiBzaGFwZS1yZW5kZXJpbmc9Imdlb21ldHJpY1ByZWNpc2lvbiI+Cjxwb2x5Z29uIHN0cm9rZS1saW5lam9pbj0icm91bmQiIGZpbGw9Im5vbmUiIHBvaW50cz0iOCAxIDE1IDE1IDEgMTUgOCAxIi8+CjxyZWN0IHg9IjgiIHk9IjEyIiB3aWR0aD0iMC4wMSIgaGVpZ2h0PSIwLjAxIi8+CjxsaW5lIHgxPSI4IiB5MT0iNiIgeDI9IjgiIHkyPSIxMCIvPgo8L2c+Cjwvc3ZnPg==");\n    background-color: darkorange;\n}\n.ace_icon_svg.ace_info {\n    -webkit-mask-image: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMCAxNiI+CjxnIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlPSJibHVlIiBzaGFwZS1yZW5kZXJpbmc9Imdlb21ldHJpY1ByZWNpc2lvbiI+CjxjaXJjbGUgZmlsbD0ibm9uZSIgY3g9IjgiIGN5PSI4IiByPSI3IiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+Cjxwb2x5bGluZSBwb2ludHM9IjggMTEgOCA4Ii8+Cjxwb2x5bGluZSBwb2ludHM9IjkgOCA2IDgiLz4KPGxpbmUgeDE9IjEwIiB5MT0iMTEiIHgyPSI2IiB5Mj0iMTEiLz4KPHJlY3QgeD0iOCIgeT0iNSIgd2lkdGg9IjAuMDEiIGhlaWdodD0iMC4wMSIvPgo8L2c+Cjwvc3ZnPg==");\n    background-color: royalblue;\n}\n\n.ace_icon_svg.ace_error_fold {\n    -webkit-mask-image: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMCAxNiIgZmlsbD0ibm9uZSI+CiAgPHBhdGggZD0ibSAxOC45Mjk4NTEsNy44Mjk4MDc2IGMgMC4xNDYzNTMsNi4zMzc0NjA0IC02LjMyMzE0Nyw3Ljc3Nzg0NDQgLTcuNDc3OTEyLDcuNzc3ODQ0NCAtMi4xMDcyNzI2LC0wLjEyODc1IDUuMTE3Njc4LDAuMzU2MjQ5IDUuMDUxNjk4LC03Ljg3MDA2MTggLTAuNjA0NjcyLC04LjAwMzk3MzQ5IC03LjA3NzI3MDYsLTcuNTYzMTE4OSAtNC44NTczLC03LjQzMDM5NTU2IDEuNjA2LC0wLjExNTE0MjI1IDYuODk3NDg1LDEuMjYyNTQ1OTYgNy4yODM1MTQsNy41MjI2MTI5NiB6IiBmaWxsPSJjcmltc29uIiBzdHJva2Utd2lkdGg9IjIiLz4KICA8cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0ibSA4LjExNDc1NjIsMi4wNTI5ODI4IGMgMy4zNDkxNjk4LDAgNi4wNjQxMzI4LDIuNjc2ODYyNyA2LjA2NDEzMjgsNS45Nzg5NTMgMCwzLjMwMjExMjIgLTIuNzE0OTYzLDUuOTc4OTIwMiAtNi4wNjQxMzI4LDUuOTc4OTIwMiAtMy4zNDkxNDczLDAgLTYuMDY0MTc3MiwtMi42NzY4MDggLTYuMDY0MTc3MiwtNS45Nzg5MjAyIDAuMDA1MzksLTMuMjk5ODg2MSAyLjcxNzI2NTYsLTUuOTczNjQwOCA2LjA2NDE3NzIsLTUuOTc4OTUzIHogbSAwLC0xLjczNTgyNzE5IGMgLTQuMzIxNDgzNiwwIC03LjgyNDc0MDM4LDMuNDU0MDE4NDkgLTcuODI0NzQwMzgsNy43MTQ3ODAxOSAwLDQuMjYwNzI4MiAzLjUwMzI1Njc4LDcuNzE0NzQ1MiA3LjgyNDc0MDM4LDcuNzE0NzQ1MiA0LjMyMTQ0OTgsMCA3LjgyNDY5OTgsLTMuNDU0MDE3IDcuODI0Njk5OCwtNy43MTQ3NDUyIDAsLTIuMDQ2MDkxNCAtMC44MjQzOTIsLTQuMDA4MzY3MiAtMi4yOTE3NTYsLTUuNDU1MTc0NiBDIDEyLjE4MDIyNSwxLjEyOTk2NDggMTAuMTkwMDEzLDAuMzE3MTU1NjEgOC4xMTQ3NTYyLDAuMzE3MTU1NjEgWiBNIDYuOTM3NDU2Myw4LjI0MDU5ODUgNC42NzE4Njg1LDEwLjQ4NTg1MiA2LjAwODY4MTQsMTEuODc2NzI4IDguMzE3MDAzNSw5LjYwMDc5MTEgMTAuNjI1MzM3LDExLjg3NjcyOCAxMS45NjIxMzgsMTAuNDg1ODUyIDkuNjk2NTUwOCw4LjI0MDU5ODUgMTEuOTYyMTM4LDYuMDA2ODA2NiAxMC41NzMyNDYsNC42Mzc0MzM1IDguMzE3MDAzNSw2Ljg3MzQyOTcgNi4wNjA3NjA3LDQuNjM3NDMzNSA0LjY3MTg2ODUsNi4wMDY4MDY2IFoiIGZpbGw9ImNyaW1zb24iIHN0cm9rZS13aWR0aD0iMiIvPgo8L3N2Zz4=");\n    background-color: crimson;\n}\n.ace_icon_svg.ace_warning_fold {\n    -webkit-mask-image: url("data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAyMCAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik0xNC43NzY5IDE0LjczMzdMOC42NTE5MiAyLjQ4MzY5QzguMzI5NDYgMS44Mzg3NyA3LjQwOTEzIDEuODM4NzcgNy4wODY2NyAyLjQ4MzY5TDAuOTYxNjY5IDE0LjczMzdDMC42NzA3NzUgMTUuMzE1NSAxLjA5MzgzIDE2IDEuNzQ0MjkgMTZIMTMuOTk0M0MxNC42NDQ4IDE2IDE1LjA2NzggMTUuMzE1NSAxNC43NzY5IDE0LjczMzdaTTMuMTYwMDcgMTQuMjVMNy44NjkyOSA0LjgzMTU2TDEyLjU3ODUgMTQuMjVIMy4xNjAwN1pNOC43NDQyOSAxMS42MjVWMTMuMzc1SDYuOTk0MjlWMTEuNjI1SDguNzQ0MjlaTTYuOTk0MjkgMTAuNzVWNy4yNUg4Ljc0NDI5VjEwLjc1SDYuOTk0MjlaIiBmaWxsPSIjRUM3MjExIi8+CjxwYXRoIGQ9Ik0xMS4xOTkxIDIuOTUyMzhDMTAuODgwOSAyLjMxNDY3IDEwLjM1MzcgMS44MDUyNiA5LjcwNTUgMS41MDlMMTEuMDQxIDEuMDY5NzhDMTEuNjg4MyAwLjk0OTgxNCAxMi4zMzcgMS4yNzI2MyAxMi42MzE3IDEuODYxNDFMMTcuNjEzNiAxMS44MTYxQzE4LjM1MjcgMTMuMjkyOSAxNy41OTM4IDE1LjA4MDQgMTYuMDE4IDE1LjU3NDVDMTYuNDA0NCAxNC40NTA3IDE2LjMyMzEgMTMuMjE4OCAxNS43OTI0IDEyLjE1NTVMMTEuMTk5MSAyLjk1MjM4WiIgZmlsbD0iI0VDNzIxMSIvPgo8L3N2Zz4=");\n    background-color: darkorange;\n}\n\n.ace_scrollbar {\n    contain: strict;\n    position: absolute;\n    right: 0;\n    bottom: 0;\n    z-index: 6;\n}\n\n.ace_scrollbar-inner {\n    position: absolute;\n    cursor: text;\n    left: 0;\n    top: 0;\n}\n\n.ace_scrollbar-v{\n    overflow-x: hidden;\n    overflow-y: scroll;\n    top: 0;\n}\n\n.ace_scrollbar-h {\n    overflow-x: scroll;\n    overflow-y: hidden;\n    left: 0;\n}\n\n.ace_print-margin {\n    position: absolute;\n    height: 100%;\n}\n\n.ace_text-input {\n    position: absolute;\n    z-index: 0;\n    width: 0.5em;\n    height: 1em;\n    opacity: 0;\n    background: transparent;\n    -moz-appearance: none;\n    appearance: none;\n    border: none;\n    resize: none;\n    outline: none;\n    overflow: hidden;\n    font: inherit;\n    padding: 0 1px;\n    margin: 0 -1px;\n    contain: strict;\n    -ms-user-select: text;\n    -moz-user-select: text;\n    -webkit-user-select: text;\n    user-select: text;\n    /*with `pre-line` chrome inserts &nbsp; instead of space*/\n    white-space: pre!important;\n}\n.ace_text-input.ace_composition {\n    background: transparent;\n    color: inherit;\n    z-index: 1000;\n    opacity: 1;\n}\n.ace_composition_placeholder { color: transparent }\n.ace_composition_marker { \n    border-bottom: 1px solid;\n    position: absolute;\n    border-radius: 0;\n    margin-top: 1px;\n}\n\n[ace_nocontext=true] {\n    transform: none!important;\n    filter: none!important;\n    clip-path: none!important;\n    mask : none!important;\n    contain: none!important;\n    perspective: none!important;\n    mix-blend-mode: initial!important;\n    z-index: auto;\n}\n\n.ace_layer {\n    z-index: 1;\n    position: absolute;\n    overflow: hidden;\n    /* workaround for chrome bug https://github.com/ajaxorg/ace/issues/2312*/\n    word-wrap: normal;\n    white-space: pre;\n    height: 100%;\n    width: 100%;\n    box-sizing: border-box;\n    /* setting pointer-events: auto; on node under the mouse, which changes\n        during scroll, will break mouse wheel scrolling in Safari */\n    pointer-events: none;\n}\n\n.ace_gutter-layer {\n    position: relative;\n    width: auto;\n    text-align: right;\n    pointer-events: auto;\n    height: 1000000px;\n    contain: style size layout;\n}\n\n.ace_text-layer {\n    font: inherit !important;\n    position: absolute;\n    height: 1000000px;\n    width: 1000000px;\n    contain: style size layout;\n}\n\n.ace_text-layer > .ace_line, .ace_text-layer > .ace_line_group {\n    contain: style size layout;\n    position: absolute;\n    top: 0;\n    left: 0;\n    right: 0;\n}\n\n.ace_hidpi .ace_text-layer,\n.ace_hidpi .ace_gutter-layer,\n.ace_hidpi .ace_content,\n.ace_hidpi .ace_gutter {\n    contain: strict;\n}\n.ace_hidpi .ace_text-layer > .ace_line, \n.ace_hidpi .ace_text-layer > .ace_line_group {\n    contain: strict;\n}\n\n.ace_cjk {\n    display: inline-block;\n    text-align: center;\n}\n\n.ace_cursor-layer {\n    z-index: 4;\n}\n\n.ace_cursor {\n    z-index: 4;\n    position: absolute;\n    box-sizing: border-box;\n    border-left: 2px solid;\n    /* workaround for smooth cursor repaintng whole screen in chrome */\n    transform: translatez(0);\n}\n\n.ace_multiselect .ace_cursor {\n    border-left-width: 1px;\n}\n\n.ace_slim-cursors .ace_cursor {\n    border-left-width: 1px;\n}\n\n.ace_overwrite-cursors .ace_cursor {\n    border-left-width: 0;\n    border-bottom: 1px solid;\n}\n\n.ace_hidden-cursors .ace_cursor {\n    opacity: 0.2;\n}\n\n.ace_hasPlaceholder .ace_hidden-cursors .ace_cursor {\n    opacity: 0;\n}\n\n.ace_smooth-blinking .ace_cursor {\n    transition: opacity 0.18s;\n}\n\n.ace_animate-blinking .ace_cursor {\n    animation-duration: 1000ms;\n    animation-timing-function: step-end;\n    animation-name: blink-ace-animate;\n    animation-iteration-count: infinite;\n}\n\n.ace_animate-blinking.ace_smooth-blinking .ace_cursor {\n    animation-duration: 1000ms;\n    animation-timing-function: ease-in-out;\n    animation-name: blink-ace-animate-smooth;\n}\n    \n@keyframes blink-ace-animate {\n    from, to { opacity: 1; }\n    60% { opacity: 0; }\n}\n\n@keyframes blink-ace-animate-smooth {\n    from, to { opacity: 1; }\n    45% { opacity: 1; }\n    60% { opacity: 0; }\n    85% { opacity: 0; }\n}\n\n.ace_marker-layer .ace_step, .ace_marker-layer .ace_stack {\n    position: absolute;\n    z-index: 3;\n}\n\n.ace_marker-layer .ace_selection {\n    position: absolute;\n    z-index: 5;\n}\n\n.ace_marker-layer .ace_bracket {\n    position: absolute;\n    z-index: 6;\n}\n\n.ace_marker-layer .ace_error_bracket {\n    position: absolute;\n    border-bottom: 1px solid #DE5555;\n    border-radius: 0;\n}\n\n.ace_marker-layer .ace_active-line {\n    position: absolute;\n    z-index: 2;\n}\n\n.ace_marker-layer .ace_selected-word {\n    position: absolute;\n    z-index: 4;\n    box-sizing: border-box;\n}\n\n.ace_line .ace_fold {\n    box-sizing: border-box;\n\n    display: inline-block;\n    height: 11px;\n    margin-top: -2px;\n    vertical-align: middle;\n\n    background-image:\n        url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABEAAAAJCAYAAADU6McMAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAJpJREFUeNpi/P//PwOlgAXGYGRklAVSokD8GmjwY1wasKljQpYACtpCFeADcHVQfQyMQAwzwAZI3wJKvCLkfKBaMSClBlR7BOQikCFGQEErIH0VqkabiGCAqwUadAzZJRxQr/0gwiXIal8zQQPnNVTgJ1TdawL0T5gBIP1MUJNhBv2HKoQHHjqNrA4WO4zY0glyNKLT2KIfIMAAQsdgGiXvgnYAAAAASUVORK5CYII="),\n        url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAA3CAYAAADNNiA5AAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAACJJREFUeNpi+P//fxgTAwPDBxDxD078RSX+YeEyDFMCIMAAI3INmXiwf2YAAAAASUVORK5CYII=");\n    background-repeat: no-repeat, repeat-x;\n    background-position: center center, top left;\n    color: transparent;\n\n    border: 1px solid black;\n    border-radius: 2px;\n\n    cursor: pointer;\n    pointer-events: auto;\n}\n\n.ace_dark .ace_fold {\n}\n\n.ace_fold:hover{\n    background-image:\n        url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABEAAAAJCAYAAADU6McMAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAJpJREFUeNpi/P//PwOlgAXGYGRklAVSokD8GmjwY1wasKljQpYACtpCFeADcHVQfQyMQAwzwAZI3wJKvCLkfKBaMSClBlR7BOQikCFGQEErIH0VqkabiGCAqwUadAzZJRxQr/0gwiXIal8zQQPnNVTgJ1TdawL0T5gBIP1MUJNhBv2HKoQHHjqNrA4WO4zY0glyNKLT2KIfIMAAQsdgGiXvgnYAAAAASUVORK5CYII="),\n        url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAA3CAYAAADNNiA5AAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAACBJREFUeNpi+P//fz4TAwPDZxDxD5X4i5fLMEwJgAADAEPVDbjNw87ZAAAAAElFTkSuQmCC");\n}\n\n.ace_tooltip {\n    background-color: #f5f5f5;\n    border: 1px solid gray;\n    border-radius: 1px;\n    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);\n    color: black;\n    max-width: 100%;\n    padding: 3px 4px;\n    position: fixed;\n    z-index: 999999;\n    box-sizing: border-box;\n    cursor: default;\n    white-space: pre;\n    word-wrap: break-word;\n    line-height: normal;\n    font-style: normal;\n    font-weight: normal;\n    letter-spacing: normal;\n    pointer-events: none;\n}\n\n.ace_tooltip.ace_dark {\n    background-color: #636363;\n    color: #fff;\n}\n\n.ace_tooltip:focus {\n    outline: 1px solid #5E9ED6;\n}\n\n.ace_icon {\n    display: inline-block;\n    width: 18px;\n    vertical-align: top;\n}\n\n.ace_icon_svg {\n    display: inline-block;\n    width: 12px;\n    vertical-align: top;\n    -webkit-mask-repeat: no-repeat;\n    -webkit-mask-size: 12px;\n    -webkit-mask-position: center;\n}\n\n.ace_folding-enabled > .ace_gutter-cell, .ace_folding-enabled > .ace_gutter-cell_svg-icons {\n    padding-right: 13px;\n}\n\n.ace_fold-widget {\n    box-sizing: border-box;\n\n    margin: 0 -12px 0 1px;\n    display: none;\n    width: 11px;\n    vertical-align: top;\n\n    background-image: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAANElEQVR42mWKsQ0AMAzC8ixLlrzQjzmBiEjp0A6WwBCSPgKAXoLkqSot7nN3yMwR7pZ32NzpKkVoDBUxKAAAAABJRU5ErkJggg==");\n    background-repeat: no-repeat;\n    background-position: center;\n\n    border-radius: 3px;\n    \n    border: 1px solid transparent;\n    cursor: pointer;\n}\n\n.ace_folding-enabled .ace_fold-widget {\n    display: inline-block;   \n}\n\n.ace_fold-widget.ace_end {\n    background-image: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAANElEQVR42m3HwQkAMAhD0YzsRchFKI7sAikeWkrxwScEB0nh5e7KTPWimZki4tYfVbX+MNl4pyZXejUO1QAAAABJRU5ErkJggg==");\n}\n\n.ace_fold-widget.ace_closed {\n    background-image: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAMAAAAGCAYAAAAG5SQMAAAAOUlEQVR42jXKwQkAMAgDwKwqKD4EwQ26sSOkVWjgIIHAzPiCgaqiqnJHZnKICBERHN194O5b9vbLuAVRL+l0YWnZAAAAAElFTkSuQmCCXA==");\n}\n\n.ace_fold-widget:hover {\n    border: 1px solid rgba(0, 0, 0, 0.3);\n    background-color: rgba(255, 255, 255, 0.2);\n    box-shadow: 0 1px 1px rgba(255, 255, 255, 0.7);\n}\n\n.ace_fold-widget:active {\n    border: 1px solid rgba(0, 0, 0, 0.4);\n    background-color: rgba(0, 0, 0, 0.05);\n    box-shadow: 0 1px 1px rgba(255, 255, 255, 0.8);\n}\n/**\n * Dark version for fold widgets\n */\n.ace_dark .ace_fold-widget {\n    background-image: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHklEQVQIW2P4//8/AzoGEQ7oGCaLLAhWiSwB146BAQCSTPYocqT0AAAAAElFTkSuQmCC");\n}\n.ace_dark .ace_fold-widget.ace_end {\n    background-image: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAH0lEQVQIW2P4//8/AxQ7wNjIAjDMgC4AxjCVKBirIAAF0kz2rlhxpAAAAABJRU5ErkJggg==");\n}\n.ace_dark .ace_fold-widget.ace_closed {\n    background-image: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAMAAAAFCAYAAACAcVaiAAAAHElEQVQIW2P4//+/AxAzgDADlOOAznHAKgPWAwARji8UIDTfQQAAAABJRU5ErkJggg==");\n}\n.ace_dark .ace_fold-widget:hover {\n    box-shadow: 0 1px 1px rgba(255, 255, 255, 0.2);\n    background-color: rgba(255, 255, 255, 0.1);\n}\n.ace_dark .ace_fold-widget:active {\n    box-shadow: 0 1px 1px rgba(255, 255, 255, 0.2);\n}\n\n.ace_inline_button {\n    border: 1px solid lightgray;\n    display: inline-block;\n    margin: -1px 8px;\n    padding: 0 5px;\n    pointer-events: auto;\n    cursor: pointer;\n}\n.ace_inline_button:hover {\n    border-color: gray;\n    background: rgba(200,200,200,0.2);\n    display: inline-block;\n    pointer-events: auto;\n}\n\n.ace_fold-widget.ace_invalid {\n    background-color: #FFB4B4;\n    border-color: #DE5555;\n}\n\n.ace_fade-fold-widgets .ace_fold-widget {\n    transition: opacity 0.4s ease 0.05s;\n    opacity: 0;\n}\n\n.ace_fade-fold-widgets:hover .ace_fold-widget {\n    transition: opacity 0.05s ease 0.05s;\n    opacity:1;\n}\n\n.ace_underline {\n    text-decoration: underline;\n}\n\n.ace_bold {\n    font-weight: bold;\n}\n\n.ace_nobold .ace_bold {\n    font-weight: normal;\n}\n\n.ace_italic {\n    font-style: italic;\n}\n\n\n.ace_error-marker {\n    background-color: rgba(255, 0, 0,0.2);\n    position: absolute;\n    z-index: 9;\n}\n\n.ace_highlight-marker {\n    background-color: rgba(255, 255, 0,0.2);\n    position: absolute;\n    z-index: 8;\n}\n\n.ace_mobile-menu {\n    position: absolute;\n    line-height: 1.5;\n    border-radius: 4px;\n    -ms-user-select: none;\n    -moz-user-select: none;\n    -webkit-user-select: none;\n    user-select: none;\n    background: white;\n    box-shadow: 1px 3px 2px grey;\n    border: 1px solid #dcdcdc;\n    color: black;\n}\n.ace_dark > .ace_mobile-menu {\n    background: #333;\n    color: #ccc;\n    box-shadow: 1px 3px 2px grey;\n    border: 1px solid #444;\n\n}\n.ace_mobile-button {\n    padding: 2px;\n    cursor: pointer;\n    overflow: hidden;\n}\n.ace_mobile-button:hover {\n    background-color: #eee;\n    opacity:1;\n}\n.ace_mobile-button:active {\n    background-color: #ddd;\n}\n\n.ace_placeholder {\n    font-family: arial;\n    transform: scale(0.9);\n    transform-origin: left;\n    white-space: pre;\n    opacity: 0.7;\n    margin: 0 10px;\n}\n\n.ace_ghost_text {\n    opacity: 0.5;\n    font-style: italic;\n    white-space: pre;\n}\n\n.ace_screenreader-only {\n    position:absolute;\n    left:-10000px;\n    top:auto;\n    width:1px;\n    height:1px;\n    overflow:hidden;\n}';}),ace.define("ace/layer/decorators",["require","exports","module","ace/lib/dom","ace/lib/oop","ace/lib/event_emitter"],function(e,t,n){var r=e("../lib/dom"),i=e("../lib/oop"),s=e("../lib/event_emitter").EventEmitter,o=function(){function e(e,t){this.canvas=r.createElement("canvas"),this.renderer=t,this.pixelRatio=1,this.maxHeight=t.layerConfig.maxHeight,this.lineHeight=t.layerConfig.lineHeight,this.canvasHeight=e.parent.scrollHeight,this.heightRatio=this.canvasHeight/this.maxHeight,this.canvasWidth=e.width,this.minDecorationHeight=2*this.pixelRatio|0,this.halfMinDecorationHeight=this.minDecorationHeight/2|0,this.canvas.width=this.canvasWidth,this.canvas.height=this.canvasHeight,this.canvas.style.top="0px",this.canvas.style.right="0px",this.canvas.style.zIndex="7px",this.canvas.style.position="absolute",this.colors={},this.colors.dark={error:"rgba(255, 18, 18, 1)",warning:"rgba(18, 136, 18, 1)",info:"rgba(18, 18, 136, 1)"},this.colors.light={error:"rgb(255,51,51)",warning:"rgb(32,133,72)",info:"rgb(35,68,138)"},e.element.appendChild(this.canvas);}return e.prototype.$updateDecorators=function(e){function i(e,t){return e.priority<t.priority?-1:e.priority>t.priority?1:0}var t=this.renderer.theme.isDark===!0?this.colors.dark:this.colors.light;if(e){this.maxHeight=e.maxHeight,this.lineHeight=e.lineHeight,this.canvasHeight=e.height;var n=(e.lastRow+1)*this.lineHeight;n<this.canvasHeight?this.heightRatio=1:this.heightRatio=this.canvasHeight/this.maxHeight;}var r=this.canvas.getContext("2d"),s=this.renderer.session.$annotations;r.clearRect(0,0,this.canvas.width,this.canvas.height);if(s){var o={info:1,warning:2,error:3};s.forEach(function(e){e.priority=o[e.type]||null;}),s=s.sort(i);var u=this.renderer.session.$foldData;for(var a=0;a<s.length;a++){var f=s[a].row,l=this.compensateFoldRows(f,u),c=Math.round((f-l)*this.lineHeight*this.heightRatio),h=Math.round((f-l)*this.lineHeight*this.heightRatio),p=Math.round(((f-l)*this.lineHeight+this.lineHeight)*this.heightRatio),d=p-h;if(d<this.minDecorationHeight){var v=(h+p)/2|0;v<this.halfMinDecorationHeight?v=this.halfMinDecorationHeight:v+this.halfMinDecorationHeight>this.canvasHeight&&(v=this.canvasHeight-this.halfMinDecorationHeight),h=Math.round(v-this.halfMinDecorationHeight),p=Math.round(v+this.halfMinDecorationHeight);}r.fillStyle=t[s[a].type]||null,r.fillRect(0,c,this.canvasWidth,p-h);}}var m=this.renderer.session.selection.getCursor();if(m){var l=this.compensateFoldRows(m.row,u),c=Math.round((m.row-l)*this.lineHeight*this.heightRatio);r.fillStyle="rgba(0, 0, 0, 0.5)",r.fillRect(0,c,this.canvasWidth,2);}},e.prototype.compensateFoldRows=function(e,t){var n=0;if(t&&t.length>0)for(var r=0;r<t.length;r++)e>t[r].start.row&&e<t[r].end.row?n+=e-t[r].start.row:e>=t[r].end.row&&(n+=t[r].end.row-t[r].start.row);return n},e}();i.implement(o.prototype,s),t.Decorator=o;}),ace.define("ace/virtual_renderer",["require","exports","module","ace/lib/oop","ace/lib/dom","ace/lib/lang","ace/config","ace/layer/gutter","ace/layer/marker","ace/layer/text","ace/layer/cursor","ace/scrollbar","ace/scrollbar","ace/scrollbar_custom","ace/scrollbar_custom","ace/renderloop","ace/layer/font_metrics","ace/lib/event_emitter","ace/css/editor-css","ace/layer/decorators","ace/lib/useragent"],function(e,t,n){var r=e("./lib/oop"),i=e("./lib/dom"),s=e("./lib/lang"),o=e("./config"),u=e("./layer/gutter").Gutter,a=e("./layer/marker").Marker,f=e("./layer/text").Text,l=e("./layer/cursor").Cursor,c=e("./scrollbar").HScrollBar,h=e("./scrollbar").VScrollBar,p=e("./scrollbar_custom").HScrollBar,d=e("./scrollbar_custom").VScrollBar,v=e("./renderloop").RenderLoop,m=e("./layer/font_metrics").FontMetrics,g=e("./lib/event_emitter").EventEmitter,y=e("./css/editor-css"),b=e("./layer/decorators").Decorator,w=e("./lib/useragent");i.importCssString(y,"ace_editor.css",!1);var E=function(){function e(e,t){var n=this;this.container=e||i.createElement("div"),i.addCssClass(this.container,"ace_editor"),i.HI_DPI&&i.addCssClass(this.container,"ace_hidpi"),this.setTheme(t),o.get("useStrictCSP")==null&&o.set("useStrictCSP",!1),this.$gutter=i.createElement("div"),this.$gutter.className="ace_gutter",this.container.appendChild(this.$gutter),this.$gutter.setAttribute("aria-hidden",!0),this.scroller=i.createElement("div"),this.scroller.className="ace_scroller",this.container.appendChild(this.scroller),this.content=i.createElement("div"),this.content.className="ace_content",this.scroller.appendChild(this.content),this.$gutterLayer=new u(this.$gutter),this.$gutterLayer.on("changeGutterWidth",this.onGutterResize.bind(this)),this.$markerBack=new a(this.content);var r=this.$textLayer=new f(this.content);this.canvas=r.element,this.$markerFront=new a(this.content),this.$cursorLayer=new l(this.content),this.$horizScroll=!1,this.$vScroll=!1,this.scrollBar=this.scrollBarV=new h(this.container,this),this.scrollBarH=new c(this.container,this),this.scrollBarV.on("scroll",function(e){n.$scrollAnimation||n.session.setScrollTop(e.data-n.scrollMargin.top);}),this.scrollBarH.on("scroll",function(e){n.$scrollAnimation||n.session.setScrollLeft(e.data-n.scrollMargin.left);}),this.scrollTop=0,this.scrollLeft=0,this.cursorPos={row:0,column:0},this.$fontMetrics=new m(this.container),this.$textLayer.$setFontMetrics(this.$fontMetrics),this.$textLayer.on("changeCharacterSize",function(e){n.updateCharacterSize(),n.onResize(!0,n.gutterWidth,n.$size.width,n.$size.height),n._signal("changeCharacterSize",e);}),this.$size={width:0,height:0,scrollerHeight:0,scrollerWidth:0,$dirty:!0},this.layerConfig={width:1,padding:0,firstRow:0,firstRowScreen:0,lastRow:0,lineHeight:0,characterWidth:0,minHeight:1,maxHeight:1,offset:0,height:1,gutterOffset:1},this.scrollMargin={left:0,right:0,top:0,bottom:0,v:0,h:0},this.margin={left:0,right:0,top:0,bottom:0,v:0,h:0},this.$keepTextAreaAtCursor=!w.isIOS,this.$loop=new v(this.$renderChanges.bind(this),this.container.ownerDocument.defaultView),this.$loop.schedule(this.CHANGE_FULL),this.updateCharacterSize(),this.setPadding(4),this.$addResizeObserver(),o.resetOptions(this),o._signal("renderer",this);}return e.prototype.updateCharacterSize=function(){this.$textLayer.allowBoldFonts!=this.$allowBoldFonts&&(this.$allowBoldFonts=this.$textLayer.allowBoldFonts,this.setStyle("ace_nobold",!this.$allowBoldFonts)),this.layerConfig.characterWidth=this.characterWidth=this.$textLayer.getCharacterWidth(),this.layerConfig.lineHeight=this.lineHeight=this.$textLayer.getLineHeight(),this.$updatePrintMargin(),i.setStyle(this.scroller.style,"line-height",this.lineHeight+"px");},e.prototype.setSession=function(e){this.session&&this.session.doc.off("changeNewLineMode",this.onChangeNewLineMode),this.session=e,e&&this.scrollMargin.top&&e.getScrollTop()<=0&&e.setScrollTop(-this.scrollMargin.top),this.$cursorLayer.setSession(e),this.$markerBack.setSession(e),this.$markerFront.setSession(e),this.$gutterLayer.setSession(e),this.$textLayer.setSession(e);if(!e)return;this.$loop.schedule(this.CHANGE_FULL),this.session.$setFontMetrics(this.$fontMetrics),this.scrollBarH.scrollLeft=this.scrollBarV.scrollTop=null,this.onChangeNewLineMode=this.onChangeNewLineMode.bind(this),this.onChangeNewLineMode(),this.session.doc.on("changeNewLineMode",this.onChangeNewLineMode);},e.prototype.updateLines=function(e,t,n){t===undefined&&(t=Infinity),this.$changedLines?(this.$changedLines.firstRow>e&&(this.$changedLines.firstRow=e),this.$changedLines.lastRow<t&&(this.$changedLines.lastRow=t)):this.$changedLines={firstRow:e,lastRow:t};if(this.$changedLines.lastRow<this.layerConfig.firstRow){if(!n)return;this.$changedLines.lastRow=this.layerConfig.lastRow;}if(this.$changedLines.firstRow>this.layerConfig.lastRow)return;this.$loop.schedule(this.CHANGE_LINES);},e.prototype.onChangeNewLineMode=function(){this.$loop.schedule(this.CHANGE_TEXT),this.$textLayer.$updateEolChar(),this.session.$bidiHandler.setEolChar(this.$textLayer.EOL_CHAR);},e.prototype.onChangeTabSize=function(){this.$loop.schedule(this.CHANGE_TEXT|this.CHANGE_MARKER),this.$textLayer.onChangeTabSize();},e.prototype.updateText=function(){this.$loop.schedule(this.CHANGE_TEXT);},e.prototype.updateFull=function(e){e?this.$renderChanges(this.CHANGE_FULL,!0):this.$loop.schedule(this.CHANGE_FULL);},e.prototype.updateFontSize=function(){this.$textLayer.checkForSizeChanges();},e.prototype.$updateSizeAsync=function(){this.$loop.pending?this.$size.$dirty=!0:this.onResize();},e.prototype.onResize=function(e,t,n,r){if(this.resizing>2)return;this.resizing>0?this.resizing++:this.resizing=e?1:0;var i=this.container;r||(r=i.clientHeight||i.scrollHeight),n||(n=i.clientWidth||i.scrollWidth);var s=this.$updateCachedSize(e,t,n,r);this.$resizeTimer&&this.$resizeTimer.cancel();if(!this.$size.scrollerHeight||!n&&!r)return this.resizing=0;e&&(this.$gutterLayer.$padding=null),e?this.$renderChanges(s|this.$changes,!0):this.$loop.schedule(s|this.$changes),this.resizing&&(this.resizing=0),this.scrollBarH.scrollLeft=this.scrollBarV.scrollTop=null,this.$customScrollbar&&this.$updateCustomScrollbar(!0);},e.prototype.$updateCachedSize=function(e,t,n,r){r-=this.$extraHeight||0;var s=0,o=this.$size,u={width:o.width,height:o.height,scrollerHeight:o.scrollerHeight,scrollerWidth:o.scrollerWidth};r&&(e||o.height!=r)&&(o.height=r,s|=this.CHANGE_SIZE,o.scrollerHeight=o.height,this.$horizScroll&&(o.scrollerHeight-=this.scrollBarH.getHeight()),this.scrollBarV.setHeight(o.scrollerHeight),this.scrollBarV.element.style.bottom=this.scrollBarH.getHeight()+"px",s|=this.CHANGE_SCROLL);if(n&&(e||o.width!=n)){s|=this.CHANGE_SIZE,o.width=n,t==null&&(t=this.$showGutter?this.$gutter.offsetWidth:0),this.gutterWidth=t,i.setStyle(this.scrollBarH.element.style,"left",t+"px"),i.setStyle(this.scroller.style,"left",t+this.margin.left+"px"),o.scrollerWidth=Math.max(0,n-t-this.scrollBarV.getWidth()-this.margin.h),i.setStyle(this.$gutter.style,"left",this.margin.left+"px");var a=this.scrollBarV.getWidth()+"px";i.setStyle(this.scrollBarH.element.style,"right",a),i.setStyle(this.scroller.style,"right",a),i.setStyle(this.scroller.style,"bottom",this.scrollBarH.getHeight()),this.scrollBarH.setWidth(o.scrollerWidth);if(this.session&&this.session.getUseWrapMode()&&this.adjustWrapLimit()||e)s|=this.CHANGE_FULL;}return o.$dirty=!n||!r,s&&this._signal("resize",u),s},e.prototype.onGutterResize=function(e){var t=this.$showGutter?e:0;t!=this.gutterWidth&&(this.$changes|=this.$updateCachedSize(!0,t,this.$size.width,this.$size.height)),this.session.getUseWrapMode()&&this.adjustWrapLimit()?this.$loop.schedule(this.CHANGE_FULL):this.$size.$dirty?this.$loop.schedule(this.CHANGE_FULL):this.$computeLayerConfig();},e.prototype.adjustWrapLimit=function(){var e=this.$size.scrollerWidth-this.$padding*2,t=Math.floor(e/this.characterWidth);return this.session.adjustWrapLimit(t,this.$showPrintMargin&&this.$printMarginColumn)},e.prototype.setAnimatedScroll=function(e){this.setOption("animatedScroll",e);},e.prototype.getAnimatedScroll=function(){return this.$animatedScroll},e.prototype.setShowInvisibles=function(e){this.setOption("showInvisibles",e),this.session.$bidiHandler.setShowInvisibles(e);},e.prototype.getShowInvisibles=function(){return this.getOption("showInvisibles")},e.prototype.getDisplayIndentGuides=function(){return this.getOption("displayIndentGuides")},e.prototype.setDisplayIndentGuides=function(e){this.setOption("displayIndentGuides",e);},e.prototype.getHighlightIndentGuides=function(){return this.getOption("highlightIndentGuides")},e.prototype.setHighlightIndentGuides=function(e){this.setOption("highlightIndentGuides",e);},e.prototype.setShowPrintMargin=function(e){this.setOption("showPrintMargin",e);},e.prototype.getShowPrintMargin=function(){return this.getOption("showPrintMargin")},e.prototype.setPrintMarginColumn=function(e){this.setOption("printMarginColumn",e);},e.prototype.getPrintMarginColumn=function(){return this.getOption("printMarginColumn")},e.prototype.getShowGutter=function(){return this.getOption("showGutter")},e.prototype.setShowGutter=function(e){return this.setOption("showGutter",e)},e.prototype.getFadeFoldWidgets=function(){return this.getOption("fadeFoldWidgets")},e.prototype.setFadeFoldWidgets=function(e){this.setOption("fadeFoldWidgets",e);},e.prototype.setHighlightGutterLine=function(e){this.setOption("highlightGutterLine",e);},e.prototype.getHighlightGutterLine=function(){return this.getOption("highlightGutterLine")},e.prototype.$updatePrintMargin=function(){if(!this.$showPrintMargin&&!this.$printMarginEl)return;if(!this.$printMarginEl){var e=i.createElement("div");e.className="ace_layer ace_print-margin-layer",this.$printMarginEl=i.createElement("div"),this.$printMarginEl.className="ace_print-margin",e.appendChild(this.$printMarginEl),this.content.insertBefore(e,this.content.firstChild);}var t=this.$printMarginEl.style;t.left=Math.round(this.characterWidth*this.$printMarginColumn+this.$padding)+"px",t.visibility=this.$showPrintMargin?"visible":"hidden",this.session&&this.session.$wrap==-1&&this.adjustWrapLimit();},e.prototype.getContainerElement=function(){return this.container},e.prototype.getMouseEventTarget=function(){return this.scroller},e.prototype.getTextAreaContainer=function(){return this.container},e.prototype.$moveTextAreaToCursor=function(){if(this.$isMousePressed)return;var e=this.textarea.style,t=this.$composition;if(!this.$keepTextAreaAtCursor&&!t){i.translate(this.textarea,-100,0);return}var n=this.$cursorLayer.$pixelPos;if(!n)return;t&&t.markerRange&&(n=this.$cursorLayer.getPixelPosition(t.markerRange.start,!0));var r=this.layerConfig,s=n.top,o=n.left;s-=r.offset;var u=t&&t.useTextareaForIME||w.isMobile?this.lineHeight:1;if(s<0||s>r.height-u){i.translate(this.textarea,0,0);return}var a=1,f=this.$size.height-u;if(!t)s+=this.lineHeight;else if(t.useTextareaForIME){var l=this.textarea.value;a=this.characterWidth*this.session.$getStringScreenWidth(l)[0];}else s+=this.lineHeight+2;o-=this.scrollLeft,o>this.$size.scrollerWidth-a&&(o=this.$size.scrollerWidth-a),o+=this.gutterWidth+this.margin.left,i.setStyle(e,"height",u+"px"),i.setStyle(e,"width",a+"px"),i.translate(this.textarea,Math.min(o,this.$size.scrollerWidth-a),Math.min(s,f));},e.prototype.getFirstVisibleRow=function(){return this.layerConfig.firstRow},e.prototype.getFirstFullyVisibleRow=function(){return this.layerConfig.firstRow+(this.layerConfig.offset===0?0:1)},e.prototype.getLastFullyVisibleRow=function(){var e=this.layerConfig,t=e.lastRow,n=this.session.documentToScreenRow(t,0)*e.lineHeight;return n-this.session.getScrollTop()>e.height-e.lineHeight?t-1:t},e.prototype.getLastVisibleRow=function(){return this.layerConfig.lastRow},e.prototype.setPadding=function(e){this.$padding=e,this.$textLayer.setPadding(e),this.$cursorLayer.setPadding(e),this.$markerFront.setPadding(e),this.$markerBack.setPadding(e),this.$loop.schedule(this.CHANGE_FULL),this.$updatePrintMargin();},e.prototype.setScrollMargin=function(e,t,n,r){var i=this.scrollMargin;i.top=e|0,i.bottom=t|0,i.right=r|0,i.left=n|0,i.v=i.top+i.bottom,i.h=i.left+i.right,i.top&&this.scrollTop<=0&&this.session&&this.session.setScrollTop(-i.top),this.updateFull();},e.prototype.setMargin=function(e,t,n,r){var i=this.margin;i.top=e|0,i.bottom=t|0,i.right=r|0,i.left=n|0,i.v=i.top+i.bottom,i.h=i.left+i.right,this.$updateCachedSize(!0,this.gutterWidth,this.$size.width,this.$size.height),this.updateFull();},e.prototype.getHScrollBarAlwaysVisible=function(){return this.$hScrollBarAlwaysVisible},e.prototype.setHScrollBarAlwaysVisible=function(e){this.setOption("hScrollBarAlwaysVisible",e);},e.prototype.getVScrollBarAlwaysVisible=function(){return this.$vScrollBarAlwaysVisible},e.prototype.setVScrollBarAlwaysVisible=function(e){this.setOption("vScrollBarAlwaysVisible",e);},e.prototype.$updateScrollBarV=function(){var e=this.layerConfig.maxHeight,t=this.$size.scrollerHeight;!this.$maxLines&&this.$scrollPastEnd&&(e-=(t-this.lineHeight)*this.$scrollPastEnd,this.scrollTop>e-t&&(e=this.scrollTop+t,this.scrollBarV.scrollTop=null)),this.scrollBarV.setScrollHeight(e+this.scrollMargin.v),this.scrollBarV.setScrollTop(this.scrollTop+this.scrollMargin.top);},e.prototype.$updateScrollBarH=function(){this.scrollBarH.setScrollWidth(this.layerConfig.width+2*this.$padding+this.scrollMargin.h),this.scrollBarH.setScrollLeft(this.scrollLeft+this.scrollMargin.left);},e.prototype.freeze=function(){this.$frozen=!0;},e.prototype.unfreeze=function(){this.$frozen=!1;},e.prototype.$renderChanges=function(e,t){this.$changes&&(e|=this.$changes,this.$changes=0);if(!this.session||!this.container.offsetWidth||this.$frozen||!e&&!t){this.$changes|=e;return}if(this.$size.$dirty)return this.$changes|=e,this.onResize(!0);this.lineHeight||this.$textLayer.checkForSizeChanges(),this._signal("beforeRender",e),this.session&&this.session.$bidiHandler&&this.session.$bidiHandler.updateCharacterWidths(this.$fontMetrics);var n=this.layerConfig;if(e&this.CHANGE_FULL||e&this.CHANGE_SIZE||e&this.CHANGE_TEXT||e&this.CHANGE_LINES||e&this.CHANGE_SCROLL||e&this.CHANGE_H_SCROLL){e|=this.$computeLayerConfig()|this.$loop.clear();if(n.firstRow!=this.layerConfig.firstRow&&n.firstRowScreen==this.layerConfig.firstRowScreen){var r=this.scrollTop+(n.firstRow-Math.max(this.layerConfig.firstRow,0))*this.lineHeight;r>0&&(this.scrollTop=r,e|=this.CHANGE_SCROLL,e|=this.$computeLayerConfig()|this.$loop.clear());}n=this.layerConfig,this.$updateScrollBarV(),e&this.CHANGE_H_SCROLL&&this.$updateScrollBarH(),i.translate(this.content,-this.scrollLeft,-n.offset);var s=n.width+2*this.$padding+"px",o=n.minHeight+"px";i.setStyle(this.content.style,"width",s),i.setStyle(this.content.style,"height",o);}e&this.CHANGE_H_SCROLL&&(i.translate(this.content,-this.scrollLeft,-n.offset),this.scroller.className=this.scrollLeft<=0?"ace_scroller ":"ace_scroller ace_scroll-left ",this.enableKeyboardAccessibility&&(this.scroller.className+=this.keyboardFocusClassName));if(e&this.CHANGE_FULL){this.$changedLines=null,this.$textLayer.update(n),this.$showGutter&&this.$gutterLayer.update(n),this.$customScrollbar&&this.$scrollDecorator.$updateDecorators(n),this.$markerBack.update(n),this.$markerFront.update(n),this.$cursorLayer.update(n),this.$moveTextAreaToCursor(),this._signal("afterRender",e);return}if(e&this.CHANGE_SCROLL){this.$changedLines=null,e&this.CHANGE_TEXT||e&this.CHANGE_LINES?this.$textLayer.update(n):this.$textLayer.scrollLines(n),this.$showGutter&&(e&this.CHANGE_GUTTER||e&this.CHANGE_LINES?this.$gutterLayer.update(n):this.$gutterLayer.scrollLines(n)),this.$customScrollbar&&this.$scrollDecorator.$updateDecorators(n),this.$markerBack.update(n),this.$markerFront.update(n),this.$cursorLayer.update(n),this.$moveTextAreaToCursor(),this._signal("afterRender",e);return}e&this.CHANGE_TEXT?(this.$changedLines=null,this.$textLayer.update(n),this.$showGutter&&this.$gutterLayer.update(n),this.$customScrollbar&&this.$scrollDecorator.$updateDecorators(n)):e&this.CHANGE_LINES?((this.$updateLines()||e&this.CHANGE_GUTTER&&this.$showGutter)&&this.$gutterLayer.update(n),this.$customScrollbar&&this.$scrollDecorator.$updateDecorators(n)):e&this.CHANGE_TEXT||e&this.CHANGE_GUTTER?(this.$showGutter&&this.$gutterLayer.update(n),this.$customScrollbar&&this.$scrollDecorator.$updateDecorators(n)):e&this.CHANGE_CURSOR&&(this.$highlightGutterLine&&this.$gutterLayer.updateLineHighlight(n),this.$customScrollbar&&this.$scrollDecorator.$updateDecorators(n)),e&this.CHANGE_CURSOR&&(this.$cursorLayer.update(n),this.$moveTextAreaToCursor()),e&(this.CHANGE_MARKER|this.CHANGE_MARKER_FRONT)&&this.$markerFront.update(n),e&(this.CHANGE_MARKER|this.CHANGE_MARKER_BACK)&&this.$markerBack.update(n),this._signal("afterRender",e);},e.prototype.$autosize=function(){var e=this.session.getScreenLength()*this.lineHeight,t=this.$maxLines*this.lineHeight,n=Math.min(t,Math.max((this.$minLines||1)*this.lineHeight,e))+this.scrollMargin.v+(this.$extraHeight||0);this.$horizScroll&&(n+=this.scrollBarH.getHeight()),this.$maxPixelHeight&&n>this.$maxPixelHeight&&(n=this.$maxPixelHeight);var r=n<=2*this.lineHeight,i=!r&&e>t;if(n!=this.desiredHeight||this.$size.height!=this.desiredHeight||i!=this.$vScroll){i!=this.$vScroll&&(this.$vScroll=i,this.scrollBarV.setVisible(i));var s=this.container.clientWidth;this.container.style.height=n+"px",this.$updateCachedSize(!0,this.$gutterWidth,s,n),this.desiredHeight=n,this._signal("autosize");}},e.prototype.$computeLayerConfig=function(){var e=this.session,t=this.$size,n=t.height<=2*this.lineHeight,r=this.session.getScreenLength(),i=r*this.lineHeight,s=this.$getLongestLine(),o=!n&&(this.$hScrollBarAlwaysVisible||t.scrollerWidth-s-2*this.$padding<0),u=this.$horizScroll!==o;u&&(this.$horizScroll=o,this.scrollBarH.setVisible(o));var a=this.$vScroll;this.$maxLines&&this.lineHeight>1&&this.$autosize();var f=t.scrollerHeight+this.lineHeight,l=!this.$maxLines&&this.$scrollPastEnd?(t.scrollerHeight-this.lineHeight)*this.$scrollPastEnd:0;i+=l;var c=this.scrollMargin;this.session.setScrollTop(Math.max(-c.top,Math.min(this.scrollTop,i-t.scrollerHeight+c.bottom))),this.session.setScrollLeft(Math.max(-c.left,Math.min(this.scrollLeft,s+2*this.$padding-t.scrollerWidth+c.right)));var h=!n&&(this.$vScrollBarAlwaysVisible||t.scrollerHeight-i+l<0||this.scrollTop>c.top),p=a!==h;p&&(this.$vScroll=h,this.scrollBarV.setVisible(h));var d=this.scrollTop%this.lineHeight,v=Math.ceil(f/this.lineHeight)-1,m=Math.max(0,Math.round((this.scrollTop-d)/this.lineHeight)),g=m+v,y,b,w=this.lineHeight;m=e.screenToDocumentRow(m,0);var E=e.getFoldLine(m);E&&(m=E.start.row),y=e.documentToScreenRow(m,0),b=e.getRowLength(m)*w,g=Math.min(e.screenToDocumentRow(g,0),e.getLength()-1),f=t.scrollerHeight+e.getRowLength(g)*w+b,d=this.scrollTop-y*w;var S=0;if(this.layerConfig.width!=s||u)S=this.CHANGE_H_SCROLL;if(u||p)S|=this.$updateCachedSize(!0,this.gutterWidth,t.width,t.height),this._signal("scrollbarVisibilityChanged"),p&&(s=this.$getLongestLine());return this.layerConfig={width:s,padding:this.$padding,firstRow:m,firstRowScreen:y,lastRow:g,lineHeight:w,characterWidth:this.characterWidth,minHeight:f,maxHeight:i,offset:d,gutterOffset:w?Math.max(0,Math.ceil((d+t.height-t.scrollerHeight)/w)):0,height:this.$size.scrollerHeight},this.session.$bidiHandler&&this.session.$bidiHandler.setContentWidth(s-this.$padding),S},e.prototype.$updateLines=function(){if(!this.$changedLines)return;var e=this.$changedLines.firstRow,t=this.$changedLines.lastRow;this.$changedLines=null;var n=this.layerConfig;if(e>n.lastRow+1)return;if(t<n.firstRow)return;if(t===Infinity){this.$showGutter&&this.$gutterLayer.update(n),this.$textLayer.update(n);return}return this.$textLayer.updateLines(n,e,t),!0},e.prototype.$getLongestLine=function(){var e=this.session.getScreenWidth();return this.showInvisibles&&!this.session.$useWrapMode&&(e+=1),this.$textLayer&&e>this.$textLayer.MAX_LINE_LENGTH&&(e=this.$textLayer.MAX_LINE_LENGTH+30),Math.max(this.$size.scrollerWidth-2*this.$padding,Math.round(e*this.characterWidth))},e.prototype.updateFrontMarkers=function(){this.$markerFront.setMarkers(this.session.getMarkers(!0)),this.$loop.schedule(this.CHANGE_MARKER_FRONT);},e.prototype.updateBackMarkers=function(){this.$markerBack.setMarkers(this.session.getMarkers()),this.$loop.schedule(this.CHANGE_MARKER_BACK);},e.prototype.addGutterDecoration=function(e,t){this.$gutterLayer.addGutterDecoration(e,t);},e.prototype.removeGutterDecoration=function(e,t){this.$gutterLayer.removeGutterDecoration(e,t);},e.prototype.updateBreakpoints=function(e){this.$loop.schedule(this.CHANGE_GUTTER);},e.prototype.setAnnotations=function(e){this.$gutterLayer.setAnnotations(e),this.$loop.schedule(this.CHANGE_GUTTER);},e.prototype.updateCursor=function(){this.$loop.schedule(this.CHANGE_CURSOR);},e.prototype.hideCursor=function(){this.$cursorLayer.hideCursor();},e.prototype.showCursor=function(){this.$cursorLayer.showCursor();},e.prototype.scrollSelectionIntoView=function(e,t,n){this.scrollCursorIntoView(e,n),this.scrollCursorIntoView(t,n);},e.prototype.scrollCursorIntoView=function(e,t,n){if(this.$size.scrollerHeight===0)return;var r=this.$cursorLayer.getPixelPosition(e),i=r.left,s=r.top,o=n&&n.top||0,u=n&&n.bottom||0;this.$scrollAnimation&&(this.$stopAnimation=!0);var a=this.$scrollAnimation?this.session.getScrollTop():this.scrollTop;a+o>s?(t&&a+o>s+this.lineHeight&&(s-=t*this.$size.scrollerHeight),s===0&&(s=-this.scrollMargin.top),this.session.setScrollTop(s)):a+this.$size.scrollerHeight-u<s+this.lineHeight&&(t&&a+this.$size.scrollerHeight-u<s-this.lineHeight&&(s+=t*this.$size.scrollerHeight),this.session.setScrollTop(s+this.lineHeight+u-this.$size.scrollerHeight));var f=this.scrollLeft,l=2*this.layerConfig.characterWidth;i-l<f?(i-=l,i<this.$padding+l&&(i=-this.scrollMargin.left),this.session.setScrollLeft(i)):(i+=l,f+this.$size.scrollerWidth<i+this.characterWidth?this.session.setScrollLeft(Math.round(i+this.characterWidth-this.$size.scrollerWidth)):f<=this.$padding&&i-f<this.characterWidth&&this.session.setScrollLeft(0));},e.prototype.getScrollTop=function(){return this.session.getScrollTop()},e.prototype.getScrollLeft=function(){return this.session.getScrollLeft()},e.prototype.getScrollTopRow=function(){return this.scrollTop/this.lineHeight},e.prototype.getScrollBottomRow=function(){return Math.max(0,Math.floor((this.scrollTop+this.$size.scrollerHeight)/this.lineHeight)-1)},e.prototype.scrollToRow=function(e){this.session.setScrollTop(e*this.lineHeight);},e.prototype.alignCursor=function(e,t){typeof e=="number"&&(e={row:e,column:0});var n=this.$cursorLayer.getPixelPosition(e),r=this.$size.scrollerHeight-this.lineHeight,i=n.top-r*(t||0);return this.session.setScrollTop(i),i},e.prototype.$calcSteps=function(e,t){var n=0,r=this.STEPS,i=[],s=function(e,t,n){return n*(Math.pow(e-1,3)+1)+t};for(n=0;n<r;++n)i.push(s(n/this.STEPS,e,t-e));return i},e.prototype.scrollToLine=function(e,t,n,r){var i=this.$cursorLayer.getPixelPosition({row:e,column:0}),s=i.top;t&&(s-=this.$size.scrollerHeight/2);var o=this.scrollTop;this.session.setScrollTop(s),n!==!1&&this.animateScrolling(o,r);},e.prototype.animateScrolling=function(e,t){function o(){r.$timer=clearInterval(r.$timer),r.$scrollAnimation=null,r.$stopAnimation=!1,t&&t();}var n=this.scrollTop;if(!this.$animatedScroll)return;var r=this;if(e==n)return;if(this.$scrollAnimation){var i=this.$scrollAnimation.steps;if(i.length){e=i[0];if(e==n)return}}var s=r.$calcSteps(e,n);this.$scrollAnimation={from:e,to:n,steps:s},clearInterval(this.$timer),r.session.setScrollTop(s.shift()),r.session.$scrollTop=n,this.$timer=setInterval(function(){if(r.$stopAnimation){o();return}if(!r.session)return clearInterval(r.$timer);s.length?(r.session.setScrollTop(s.shift()),r.session.$scrollTop=n):n!=null?(r.session.$scrollTop=-1,r.session.setScrollTop(n),n=null):o();},10);},e.prototype.scrollToY=function(e){this.scrollTop!==e&&(this.$loop.schedule(this.CHANGE_SCROLL),this.scrollTop=e);},e.prototype.scrollToX=function(e){this.scrollLeft!==e&&(this.scrollLeft=e),this.$loop.schedule(this.CHANGE_H_SCROLL);},e.prototype.scrollTo=function(e,t){this.session.setScrollTop(t),this.session.setScrollLeft(e);},e.prototype.scrollBy=function(e,t){t&&this.session.setScrollTop(this.session.getScrollTop()+t),e&&this.session.setScrollLeft(this.session.getScrollLeft()+e);},e.prototype.isScrollableBy=function(e,t){if(t<0&&this.session.getScrollTop()>=1-this.scrollMargin.top)return !0;if(t>0&&this.session.getScrollTop()+this.$size.scrollerHeight-this.layerConfig.maxHeight<-1+this.scrollMargin.bottom)return !0;if(e<0&&this.session.getScrollLeft()>=1-this.scrollMargin.left)return !0;if(e>0&&this.session.getScrollLeft()+this.$size.scrollerWidth-this.layerConfig.width<-1+this.scrollMargin.right)return !0},e.prototype.pixelToScreenCoordinates=function(e,t){var n;if(this.$hasCssTransforms){n={top:0,left:0};var r=this.$fontMetrics.transformCoordinates([e,t]);e=r[1]-this.gutterWidth-this.margin.left,t=r[0];}else n=this.scroller.getBoundingClientRect();var i=e+this.scrollLeft-n.left-this.$padding,s=i/this.characterWidth,o=Math.floor((t+this.scrollTop-n.top)/this.lineHeight),u=this.$blockCursor?Math.floor(s):Math.round(s);return {row:o,column:u,side:s-u>0?1:-1,offsetX:i}},e.prototype.screenToTextCoordinates=function(e,t){var n;if(this.$hasCssTransforms){n={top:0,left:0};var r=this.$fontMetrics.transformCoordinates([e,t]);e=r[1]-this.gutterWidth-this.margin.left,t=r[0];}else n=this.scroller.getBoundingClientRect();var i=e+this.scrollLeft-n.left-this.$padding,s=i/this.characterWidth,o=this.$blockCursor?Math.floor(s):Math.round(s),u=Math.floor((t+this.scrollTop-n.top)/this.lineHeight);return this.session.screenToDocumentPosition(u,Math.max(o,0),i)},e.prototype.textToScreenCoordinates=function(e,t){var n=this.scroller.getBoundingClientRect(),r=this.session.documentToScreenPosition(e,t),i=this.$padding+(this.session.$bidiHandler.isBidiRow(r.row,e)?this.session.$bidiHandler.getPosLeft(r.column):Math.round(r.column*this.characterWidth)),s=r.row*this.lineHeight;return {pageX:n.left+i-this.scrollLeft,pageY:n.top+s-this.scrollTop}},e.prototype.visualizeFocus=function(){i.addCssClass(this.container,"ace_focus");},e.prototype.visualizeBlur=function(){i.removeCssClass(this.container,"ace_focus");},e.prototype.showComposition=function(e){this.$composition=e,e.cssText||(e.cssText=this.textarea.style.cssText),e.useTextareaForIME==undefined&&(e.useTextareaForIME=this.$useTextareaForIME),this.$useTextareaForIME?(i.addCssClass(this.textarea,"ace_composition"),this.textarea.style.cssText="",this.$moveTextAreaToCursor(),this.$cursorLayer.element.style.display="none"):e.markerId=this.session.addMarker(e.markerRange,"ace_composition_marker","text");},e.prototype.setCompositionText=function(e){var t=this.session.selection.cursor;this.addToken(e,"composition_placeholder",t.row,t.column),this.$moveTextAreaToCursor();},e.prototype.hideComposition=function(){if(!this.$composition)return;this.$composition.markerId&&this.session.removeMarker(this.$composition.markerId),i.removeCssClass(this.textarea,"ace_composition"),this.textarea.style.cssText=this.$composition.cssText;var e=this.session.selection.cursor;this.removeExtraToken(e.row,e.column),this.$composition=null,this.$cursorLayer.element.style.display="";},e.prototype.setGhostText=function(e,t){var n=this.session.selection.cursor,r=t||{row:n.row,column:n.column};this.removeGhostText();var i=e.split("\n");this.addToken(i[0],"ghost_text",r.row,r.column),this.$ghostText={text:e,position:{row:r.row,column:r.column}},i.length>1&&(this.$ghostTextWidget={text:i.slice(1).join("\n"),row:r.row,column:r.column,className:"ace_ghost_text"},this.session.widgetManager.addLineWidget(this.$ghostTextWidget));},e.prototype.removeGhostText=function(){if(!this.$ghostText)return;var e=this.$ghostText.position;this.removeExtraToken(e.row,e.column),this.$ghostTextWidget&&(this.session.widgetManager.removeLineWidget(this.$ghostTextWidget),this.$ghostTextWidget=null),this.$ghostText=null;},e.prototype.addToken=function(e,t,n,r){var i=this.session;i.bgTokenizer.lines[n]=null;var s={type:t,value:e},o=i.getTokens(n);if(r==null||!o.length)o.push(s);else {var u=0;for(var a=0;a<o.length;a++){var f=o[a];u+=f.value.length;if(r<=u){var l=f.value.length-(u-r),c=f.value.slice(0,l),h=f.value.slice(l);o.splice(a,1,{type:f.type,value:c},s,{type:f.type,value:h});break}}}this.updateLines(n,n);},e.prototype.removeExtraToken=function(e,t){this.session.bgTokenizer.lines[e]=null,this.updateLines(e,e);},e.prototype.setTheme=function(e,t){function s(r){if(n.$themeId!=e)return t&&t();if(!r||!r.cssClass)throw new Error("couldn't load module "+e+" or it didn't call define");r.$id&&(n.$themeId=r.$id),i.importCssString(r.cssText,r.cssClass,n.container),n.theme&&i.removeCssClass(n.container,n.theme.cssClass);var s="padding"in r?r.padding:"padding"in(n.theme||{})?4:n.$padding;n.$padding&&s!=n.$padding&&n.setPadding(s),n.$theme=r.cssClass,n.theme=r,i.addCssClass(n.container,r.cssClass),i.setCssClass(n.container,"ace_dark",r.isDark),n.$size&&(n.$size.width=0,n.$updateSizeAsync()),n._dispatchEvent("themeLoaded",{theme:r}),t&&t();}var n=this;this.$themeId=e,n._dispatchEvent("themeChange",{theme:e});if(!e||typeof e=="string"){var r=e||this.$options.theme.initialValue;o.loadModule(["theme",r],s);}else s(e);},e.prototype.getTheme=function(){return this.$themeId},e.prototype.setStyle=function(e,t){i.setCssClass(this.container,e,t!==!1);},e.prototype.unsetStyle=function(e){i.removeCssClass(this.container,e);},e.prototype.setCursorStyle=function(e){i.setStyle(this.scroller.style,"cursor",e);},e.prototype.setMouseCursor=function(e){i.setStyle(this.scroller.style,"cursor",e);},e.prototype.attachToShadowRoot=function(){i.importCssString(y,"ace_editor.css",this.container);},e.prototype.destroy=function(){this.freeze(),this.$fontMetrics.destroy(),this.$cursorLayer.destroy(),this.removeAllListeners(),this.container.textContent="",this.setOption("useResizeObserver",!1);},e.prototype.$updateCustomScrollbar=function(e){var t=this;this.$horizScroll=this.$vScroll=null,this.scrollBarV.element.remove(),this.scrollBarH.element.remove(),this.$scrollDecorator&&delete this.$scrollDecorator,e===!0?(this.scrollBarV=new d(this.container,this),this.scrollBarH=new p(this.container,this),this.scrollBarV.setHeight(this.$size.scrollerHeight),this.scrollBarH.setWidth(this.$size.scrollerWidth),this.scrollBarV.addEventListener("scroll",function(e){t.$scrollAnimation||t.session.setScrollTop(e.data-t.scrollMargin.top);}),this.scrollBarH.addEventListener("scroll",function(e){t.$scrollAnimation||t.session.setScrollLeft(e.data-t.scrollMargin.left);}),this.$scrollDecorator=new b(this.scrollBarV,this),this.$scrollDecorator.$updateDecorators()):(this.scrollBarV=new h(this.container,this),this.scrollBarH=new c(this.container,this),this.scrollBarV.addEventListener("scroll",function(e){t.$scrollAnimation||t.session.setScrollTop(e.data-t.scrollMargin.top);}),this.scrollBarH.addEventListener("scroll",function(e){t.$scrollAnimation||t.session.setScrollLeft(e.data-t.scrollMargin.left);}));},e.prototype.$addResizeObserver=function(){if(!window.ResizeObserver||this.$resizeObserver)return;var e=this;this.$resizeTimer=s.delayedCall(function(){e.destroyed||e.onResize();},50),this.$resizeObserver=new window.ResizeObserver(function(t){var n=t[0].contentRect.width,r=t[0].contentRect.height;Math.abs(e.$size.width-n)>1||Math.abs(e.$size.height-r)>1?e.$resizeTimer.delay():e.$resizeTimer.cancel();}),this.$resizeObserver.observe(this.container);},e}();E.prototype.CHANGE_CURSOR=1,E.prototype.CHANGE_MARKER=2,E.prototype.CHANGE_GUTTER=4,E.prototype.CHANGE_SCROLL=8,E.prototype.CHANGE_LINES=16,E.prototype.CHANGE_TEXT=32,E.prototype.CHANGE_SIZE=64,E.prototype.CHANGE_MARKER_BACK=128,E.prototype.CHANGE_MARKER_FRONT=256,E.prototype.CHANGE_FULL=512,E.prototype.CHANGE_H_SCROLL=1024,E.prototype.$changes=0,E.prototype.$padding=null,E.prototype.$frozen=!1,E.prototype.STEPS=8,r.implement(E.prototype,g),o.defineOptions(E.prototype,"renderer",{useResizeObserver:{set:function(e){!e&&this.$resizeObserver?(this.$resizeObserver.disconnect(),this.$resizeTimer.cancel(),this.$resizeTimer=this.$resizeObserver=null):e&&!this.$resizeObserver&&this.$addResizeObserver();}},animatedScroll:{initialValue:!1},showInvisibles:{set:function(e){this.$textLayer.setShowInvisibles(e)&&this.$loop.schedule(this.CHANGE_TEXT);},initialValue:!1},showPrintMargin:{set:function(){this.$updatePrintMargin();},initialValue:!0},printMarginColumn:{set:function(){this.$updatePrintMargin();},initialValue:80},printMargin:{set:function(e){typeof e=="number"&&(this.$printMarginColumn=e),this.$showPrintMargin=!!e,this.$updatePrintMargin();},get:function(){return this.$showPrintMargin&&this.$printMarginColumn}},showGutter:{set:function(e){this.$gutter.style.display=e?"block":"none",this.$loop.schedule(this.CHANGE_FULL),this.onGutterResize();},initialValue:!0},useSvgGutterIcons:{set:function(e){this.$gutterLayer.$useSvgGutterIcons=e;},initialValue:!1},showFoldedAnnotations:{set:function(e){this.$gutterLayer.$showFoldedAnnotations=e;},initialValue:!1},fadeFoldWidgets:{set:function(e){i.setCssClass(this.$gutter,"ace_fade-fold-widgets",e);},initialValue:!1},showFoldWidgets:{set:function(e){this.$gutterLayer.setShowFoldWidgets(e),this.$loop.schedule(this.CHANGE_GUTTER);},initialValue:!0},displayIndentGuides:{set:function(e){this.$textLayer.setDisplayIndentGuides(e)&&this.$loop.schedule(this.CHANGE_TEXT);},initialValue:!0},highlightIndentGuides:{set:function(e){this.$textLayer.setHighlightIndentGuides(e)==1?this.$textLayer.$highlightIndentGuide():this.$textLayer.$clearActiveIndentGuide(this.$textLayer.$lines.cells);},initialValue:!0},highlightGutterLine:{set:function(e){this.$gutterLayer.setHighlightGutterLine(e),this.$loop.schedule(this.CHANGE_GUTTER);},initialValue:!0},hScrollBarAlwaysVisible:{set:function(e){(!this.$hScrollBarAlwaysVisible||!this.$horizScroll)&&this.$loop.schedule(this.CHANGE_SCROLL);},initialValue:!1},vScrollBarAlwaysVisible:{set:function(e){(!this.$vScrollBarAlwaysVisible||!this.$vScroll)&&this.$loop.schedule(this.CHANGE_SCROLL);},initialValue:!1},fontSize:{set:function(e){typeof e=="number"&&(e+="px"),this.container.style.fontSize=e,this.updateFontSize();},initialValue:12},fontFamily:{set:function(e){this.container.style.fontFamily=e,this.updateFontSize();}},maxLines:{set:function(e){this.updateFull();}},minLines:{set:function(e){this.$minLines<562949953421311||(this.$minLines=0),this.updateFull();}},maxPixelHeight:{set:function(e){this.updateFull();},initialValue:0},scrollPastEnd:{set:function(e){e=+e||0;if(this.$scrollPastEnd==e)return;this.$scrollPastEnd=e,this.$loop.schedule(this.CHANGE_SCROLL);},initialValue:0,handlesSet:!0},fixedWidthGutter:{set:function(e){this.$gutterLayer.$fixedWidth=!!e,this.$loop.schedule(this.CHANGE_GUTTER);}},customScrollbar:{set:function(e){this.$updateCustomScrollbar(e);},initialValue:!1},theme:{set:function(e){this.setTheme(e);},get:function(){return this.$themeId||this.theme},initialValue:"./theme/textmate",handlesSet:!0},hasCssTransforms:{},useTextareaForIME:{initialValue:!w.isMobile&&!w.isIE}}),t.VirtualRenderer=E;}),ace.define("ace/worker/worker_client",["require","exports","module","ace/lib/oop","ace/lib/net","ace/lib/event_emitter","ace/config"],function(e,t,n){function u(e){var t="importScripts('"+i.qualifyURL(e)+"');";try{return new Blob([t],{type:"application/javascript"})}catch(n){var r=window.BlobBuilder||window.WebKitBlobBuilder||window.MozBlobBuilder,s=new r;return s.append(t),s.getBlob("application/javascript")}}function a(e){if(typeof Worker=="undefined")return {postMessage:function(){},terminate:function(){}};if(o.get("loadWorkerFromBlob")){var t=u(e),n=window.URL||window.webkitURL,r=n.createObjectURL(t);return new Worker(r)}return new Worker(e)}var r=e("../lib/oop"),i=e("../lib/net"),s=e("../lib/event_emitter").EventEmitter,o=e("../config"),f=function(e){e.postMessage||(e=this.$createWorkerFromOldConfig.apply(this,arguments)),this.$worker=e,this.$sendDeltaQueue=this.$sendDeltaQueue.bind(this),this.changeListener=this.changeListener.bind(this),this.onMessage=this.onMessage.bind(this),this.callbackId=1,this.callbacks={},this.$worker.onmessage=this.onMessage;};(function(){r.implement(this,s),this.$createWorkerFromOldConfig=function(t,n,r,i,s){e.nameToUrl&&!e.toUrl&&(e.toUrl=e.nameToUrl);if(o.get("packaged")||!e.toUrl)i=i||o.moduleUrl(n,"worker");else {var u=this.$normalizePath;i=i||u(e.toUrl("ace/worker/worker.js",null,"_"));var f={};t.forEach(function(t){f[t]=u(e.toUrl(t,null,"_").replace(/(\.js)?(\?.*)?$/,""));});}return this.$worker=a(i),s&&this.send("importScripts",s),this.$worker.postMessage({init:!0,tlns:f,module:n,classname:r}),this.$worker},this.onMessage=function(e){var t=e.data;switch(t.type){case"event":this._signal(t.name,{data:t.data});break;case"call":var n=this.callbacks[t.id];n&&(n(t.data),delete this.callbacks[t.id]);break;case"error":this.reportError(t.data);break;case"log":window.console&&console.log&&console.log.apply(console,t.data);}},this.reportError=function(e){window.console&&console.error&&console.error(e);},this.$normalizePath=function(e){return i.qualifyURL(e)},this.terminate=function(){this._signal("terminate",{}),this.deltaQueue=null,this.$worker.terminate(),this.$worker.onerror=function(e){e.preventDefault();},this.$worker=null,this.$doc&&this.$doc.off("change",this.changeListener),this.$doc=null;},this.send=function(e,t){this.$worker.postMessage({command:e,args:t});},this.call=function(e,t,n){if(n){var r=this.callbackId++;this.callbacks[r]=n,t.push(r);}this.send(e,t);},this.emit=function(e,t){try{t.data&&t.data.err&&(t.data.err={message:t.data.err.message,stack:t.data.err.stack,code:t.data.err.code}),this.$worker&&this.$worker.postMessage({event:e,data:{data:t.data}});}catch(n){console.error(n.stack);}},this.attachToDocument=function(e){this.$doc&&this.terminate(),this.$doc=e,this.call("setValue",[e.getValue()]),e.on("change",this.changeListener,!0);},this.changeListener=function(e){this.deltaQueue||(this.deltaQueue=[],setTimeout(this.$sendDeltaQueue,0)),e.action=="insert"?this.deltaQueue.push(e.start,e.lines):this.deltaQueue.push(e.start,e.end);},this.$sendDeltaQueue=function(){var e=this.deltaQueue;if(!e)return;this.deltaQueue=null,e.length>50&&e.length>this.$doc.getLength()>>1?this.call("setValue",[this.$doc.getValue()]):this.emit("change",{data:e});};}).call(f.prototype);var l=function(e,t,n){var r=null,i=!1,u=Object.create(s),a=[],l=new f({messageBuffer:a,terminate:function(){},postMessage:function(e){a.push(e);if(!r)return;i?setTimeout(c):c();}});l.setEmitSync=function(e){i=e;};var c=function(){var e=a.shift();e.command?r[e.command].apply(r,e.args):e.event&&u._signal(e.event,e.data);};return u.postMessage=function(e){l.onMessage({data:e});},u.callback=function(e,t){this.postMessage({type:"call",id:t,data:e});},u.emit=function(e,t){this.postMessage({type:"event",name:e,data:t});},o.loadModule(["worker",t],function(e){r=new e[n](u);while(a.length)c();}),l};t.UIWorkerClient=l,t.WorkerClient=f,t.createWorker=a;}),ace.define("ace/placeholder",["require","exports","module","ace/range","ace/lib/event_emitter","ace/lib/oop"],function(e,t,n){var r=e("./range").Range,i=e("./lib/event_emitter").EventEmitter,s=e("./lib/oop"),o=function(){function e(e,t,n,r,i,s){var o=this;this.length=t,this.session=e,this.doc=e.getDocument(),this.mainClass=i,this.othersClass=s,this.$onUpdate=this.onUpdate.bind(this),this.doc.on("change",this.$onUpdate,!0),this.$others=r,this.$onCursorChange=function(){setTimeout(function(){o.onCursorChange();});},this.$pos=n;var u=e.getUndoManager().$undoStack||e.getUndoManager().$undostack||{length:-1};this.$undoStackDepth=u.length,this.setup(),e.selection.on("changeCursor",this.$onCursorChange);}return e.prototype.setup=function(){var e=this,t=this.doc,n=this.session;this.selectionBefore=n.selection.toJSON(),n.selection.inMultiSelectMode&&n.selection.toSingleRange(),this.pos=t.createAnchor(this.$pos.row,this.$pos.column);var i=this.pos;i.$insertRight=!0,i.detach(),i.markerId=n.addMarker(new r(i.row,i.column,i.row,i.column+this.length),this.mainClass,null,!1),this.others=[],this.$others.forEach(function(n){var r=t.createAnchor(n.row,n.column);r.$insertRight=!0,r.detach(),e.others.push(r);}),n.setUndoSelect(!1);},e.prototype.showOtherMarkers=function(){if(this.othersActive)return;var e=this.session,t=this;this.othersActive=!0,this.others.forEach(function(n){n.markerId=e.addMarker(new r(n.row,n.column,n.row,n.column+t.length),t.othersClass,null,!1);});},e.prototype.hideOtherMarkers=function(){if(!this.othersActive)return;this.othersActive=!1;for(var e=0;e<this.others.length;e++)this.session.removeMarker(this.others[e].markerId);},e.prototype.onUpdate=function(e){if(this.$updating)return this.updateAnchors(e);var t=e;if(t.start.row!==t.end.row)return;if(t.start.row!==this.pos.row)return;this.$updating=!0;var n=e.action==="insert"?t.end.column-t.start.column:t.start.column-t.end.column,i=t.start.column>=this.pos.column&&t.start.column<=this.pos.column+this.length+1,s=t.start.column-this.pos.column;this.updateAnchors(e),i&&(this.length+=n);if(i&&!this.session.$fromUndo)if(e.action==="insert")for(var o=this.others.length-1;o>=0;o--){var u=this.others[o],a={row:u.row,column:u.column+s};this.doc.insertMergedLines(a,e.lines);}else if(e.action==="remove")for(var o=this.others.length-1;o>=0;o--){var u=this.others[o],a={row:u.row,column:u.column+s};this.doc.remove(new r(a.row,a.column,a.row,a.column-n));}this.$updating=!1,this.updateMarkers();},e.prototype.updateAnchors=function(e){this.pos.onChange(e);for(var t=this.others.length;t--;)this.others[t].onChange(e);this.updateMarkers();},e.prototype.updateMarkers=function(){if(this.$updating)return;var e=this,t=this.session,n=function(n,i){t.removeMarker(n.markerId),n.markerId=t.addMarker(new r(n.row,n.column,n.row,n.column+e.length),i,null,!1);};n(this.pos,this.mainClass);for(var i=this.others.length;i--;)n(this.others[i],this.othersClass);},e.prototype.onCursorChange=function(e){if(this.$updating||!this.session)return;var t=this.session.selection.getCursor();t.row===this.pos.row&&t.column>=this.pos.column&&t.column<=this.pos.column+this.length?(this.showOtherMarkers(),this._emit("cursorEnter",e)):(this.hideOtherMarkers(),this._emit("cursorLeave",e));},e.prototype.detach=function(){this.session.removeMarker(this.pos&&this.pos.markerId),this.hideOtherMarkers(),this.doc.off("change",this.$onUpdate),this.session.selection.off("changeCursor",this.$onCursorChange),this.session.setUndoSelect(!0),this.session=null;},e.prototype.cancel=function(){if(this.$undoStackDepth===-1)return;var e=this.session.getUndoManager(),t=(e.$undoStack||e.$undostack).length-this.$undoStackDepth;for(var n=0;n<t;n++)e.undo(this.session,!0);this.selectionBefore&&this.session.selection.fromJSON(this.selectionBefore);},e}();s.implement(o.prototype,i),t.PlaceHolder=o;}),ace.define("ace/mouse/multi_select_handler",["require","exports","module","ace/lib/event","ace/lib/useragent"],function(e,t,n){function s(e,t){return e.row==t.row&&e.column==t.column}function o(e){var t=e.domEvent,n=t.altKey,o=t.shiftKey,u=t.ctrlKey,a=e.getAccelKey(),f=e.getButton();u&&i.isMac&&(f=t.button);if(e.editor.inMultiSelectMode&&f==2){e.editor.textInput.onContextMenu(e.domEvent);return}if(!u&&!n&&!a){f===0&&e.editor.inMultiSelectMode&&e.editor.exitMultiSelectMode();return}if(f!==0)return;var l=e.editor,c=l.selection,h=l.inMultiSelectMode,p=e.getDocumentPosition(),d=c.getCursor(),v=e.inSelection()||c.isEmpty()&&s(p,d),m=e.x,g=e.y,y=function(e){m=e.clientX,g=e.clientY;},b=l.session,w=l.renderer.pixelToScreenCoordinates(m,g),E=w,S;if(l.$mouseHandler.$enableJumpToDef)u&&n||a&&n?S=o?"block":"add":n&&l.$blockSelectEnabled&&(S="block");else if(a&&!n){S="add";if(!h&&o)return}else n&&l.$blockSelectEnabled&&(S="block");S&&i.isMac&&t.ctrlKey&&l.$mouseHandler.cancelContextMenu();if(S=="add"){if(!h&&v)return;if(!h){var x=c.toOrientedRange();l.addSelectionMarker(x);}var T=c.rangeList.rangeAtPoint(p);l.inVirtualSelectionMode=!0,o&&(T=null,x=c.ranges[0]||x,l.removeSelectionMarker(x)),l.once("mouseup",function(){var e=c.toOrientedRange();T&&e.isEmpty()&&s(T.cursor,e.cursor)?c.substractPoint(e.cursor):(o?c.substractPoint(x.cursor):x&&(l.removeSelectionMarker(x),c.addRange(x)),c.addRange(e)),l.inVirtualSelectionMode=!1;});}else if(S=="block"){e.stop(),l.inVirtualSelectionMode=!0;var N,C=[],k=function(){var e=l.renderer.pixelToScreenCoordinates(m,g),t=b.screenToDocumentPosition(e.row,e.column,e.offsetX);if(s(E,e)&&s(t,c.lead))return;E=e,l.selection.moveToPosition(t),l.renderer.scrollCursorIntoView(),l.removeSelectionMarkers(C),C=c.rectangularRangeBlock(E,w),l.$mouseHandler.$clickSelection&&C.length==1&&C[0].isEmpty()&&(C[0]=l.$mouseHandler.$clickSelection.clone()),C.forEach(l.addSelectionMarker,l),l.updateSelectionMarkers();};h&&!a?c.toSingleRange():!h&&a&&(N=c.toOrientedRange(),l.addSelectionMarker(N)),o?w=b.documentToScreenPosition(c.lead):c.moveToPosition(p),E={row:-1,column:-1};var L=function(e){k(),clearInterval(O),l.removeSelectionMarkers(C),C.length||(C=[c.toOrientedRange()]),N&&(l.removeSelectionMarker(N),c.toSingleRange(N));for(var t=0;t<C.length;t++)c.addRange(C[t]);l.inVirtualSelectionMode=!1,l.$mouseHandler.$clickSelection=null;},A=k;r.capture(l.container,y,L);var O=setInterval(function(){A();},20);return e.preventDefault()}}var r=e("../lib/event"),i=e("../lib/useragent");t.onMouseDown=o;}),ace.define("ace/commands/multi_select_commands",["require","exports","module","ace/keyboard/hash_handler"],function(e,t,n){t.defaultCommands=[{name:"addCursorAbove",description:"Add cursor above",exec:function(e){e.selectMoreLines(-1);},scrollIntoView:"cursor",readOnly:!0},{name:"addCursorBelow",description:"Add cursor below",exec:function(e){e.selectMoreLines(1);},scrollIntoView:"cursor",readOnly:!0},{name:"addCursorAboveSkipCurrent",description:"Add cursor above (skip current)",exec:function(e){e.selectMoreLines(-1,!0);},scrollIntoView:"cursor",readOnly:!0},{name:"addCursorBelowSkipCurrent",description:"Add cursor below (skip current)",exec:function(e){e.selectMoreLines(1,!0);},scrollIntoView:"cursor",readOnly:!0},{name:"selectMoreBefore",description:"Select more before",exec:function(e){e.selectMore(-1);},scrollIntoView:"cursor",readOnly:!0},{name:"selectMoreAfter",description:"Select more after",exec:function(e){e.selectMore(1);},scrollIntoView:"cursor",readOnly:!0},{name:"selectNextBefore",description:"Select next before",exec:function(e){e.selectMore(-1,!0);},scrollIntoView:"cursor",readOnly:!0},{name:"selectNextAfter",description:"Select next after",exec:function(e){e.selectMore(1,!0);},scrollIntoView:"cursor",readOnly:!0},{name:"toggleSplitSelectionIntoLines",description:"Split selection into lines",exec:function(e){e.multiSelect.rangeCount>1?e.multiSelect.joinSelections():e.multiSelect.splitIntoLines();},readOnly:!0},{name:"splitSelectionIntoLines",description:"Split into lines",exec:function(e){e.multiSelect.splitIntoLines();},readOnly:!0},{name:"alignCursors",description:"Align cursors",exec:function(e){e.alignCursors();},scrollIntoView:"cursor"},{name:"findAll",description:"Find all",exec:function(e){e.findAll();},scrollIntoView:"cursor",readOnly:!0}],t.multiSelectCommands=[{name:"singleSelection",description:"Single selection",exec:function(e){e.exitMultiSelectMode();},scrollIntoView:"cursor",readOnly:!0,isAvailable:function(e){return e&&e.inMultiSelectMode}}];var r=e("../keyboard/hash_handler").HashHandler;t.keyboardHandler=new r(t.multiSelectCommands);}),ace.define("ace/multi_select",["require","exports","module","ace/range_list","ace/range","ace/selection","ace/mouse/multi_select_handler","ace/lib/event","ace/lib/lang","ace/commands/multi_select_commands","ace/search","ace/edit_session","ace/editor","ace/config"],function(e,t,n){function h(e,t,n){return c.$options.wrap=!0,c.$options.needle=t,c.$options.backwards=n==-1,c.find(e)}function v(e,t){return e.row==t.row&&e.column==t.column}function m(e){if(e.$multiselectOnSessionChange)return;e.$onAddRange=e.$onAddRange.bind(e),e.$onRemoveRange=e.$onRemoveRange.bind(e),e.$onMultiSelect=e.$onMultiSelect.bind(e),e.$onSingleSelect=e.$onSingleSelect.bind(e),e.$multiselectOnSessionChange=t.onSessionChange.bind(e),e.$checkMultiselectChange=e.$checkMultiselectChange.bind(e),e.$multiselectOnSessionChange(e),e.on("changeSession",e.$multiselectOnSessionChange),e.on("mousedown",o),e.commands.addCommands(f.defaultCommands),g(e);}function g(e){function r(t){n&&(e.renderer.setMouseCursor(""),n=!1);}if(!e.textInput)return;var t=e.textInput.getElement(),n=!1;u.addListener(t,"keydown",function(t){var i=t.keyCode==18&&!(t.ctrlKey||t.shiftKey||t.metaKey);e.$blockSelectEnabled&&i?n||(e.renderer.setMouseCursor("crosshair"),n=!0):n&&r();},e),u.addListener(t,"keyup",r,e),u.addListener(t,"blur",r,e);}var r=e("./range_list").RangeList,i=e("./range").Range,s=e("./selection").Selection,o=e("./mouse/multi_select_handler").onMouseDown,u=e("./lib/event"),a=e("./lib/lang"),f=e("./commands/multi_select_commands");t.commands=f.defaultCommands.concat(f.multiSelectCommands);var l=e("./search").Search,c=new l,p=e("./edit_session").EditSession;((function(){this.getSelectionMarkers=function(){return this.$selectionMarkers};})).call(p.prototype),function(){this.ranges=null,this.rangeList=null,this.addRange=function(e,t){if(!e)return;if(!this.inMultiSelectMode&&this.rangeCount===0){var n=this.toOrientedRange();this.rangeList.add(n),this.rangeList.add(e);if(this.rangeList.ranges.length!=2)return this.rangeList.removeAll(),t||this.fromOrientedRange(e);this.rangeList.removeAll(),this.rangeList.add(n),this.$onAddRange(n);}e.cursor||(e.cursor=e.end);var r=this.rangeList.add(e);return this.$onAddRange(e),r.length&&this.$onRemoveRange(r),this.rangeCount>1&&!this.inMultiSelectMode&&(this._signal("multiSelect"),this.inMultiSelectMode=!0,this.session.$undoSelect=!1,this.rangeList.attach(this.session)),t||this.fromOrientedRange(e)},this.toSingleRange=function(e){e=e||this.ranges[0];var t=this.rangeList.removeAll();t.length&&this.$onRemoveRange(t),e&&this.fromOrientedRange(e);},this.substractPoint=function(e){var t=this.rangeList.substractPoint(e);if(t)return this.$onRemoveRange(t),t[0]},this.mergeOverlappingRanges=function(){var e=this.rangeList.merge();e.length&&this.$onRemoveRange(e);},this.$onAddRange=function(e){this.rangeCount=this.rangeList.ranges.length,this.ranges.unshift(e),this._signal("addRange",{range:e});},this.$onRemoveRange=function(e){this.rangeCount=this.rangeList.ranges.length;if(this.rangeCount==1&&this.inMultiSelectMode){var t=this.rangeList.ranges.pop();e.push(t),this.rangeCount=0;}for(var n=e.length;n--;){var r=this.ranges.indexOf(e[n]);this.ranges.splice(r,1);}this._signal("removeRange",{ranges:e}),this.rangeCount===0&&this.inMultiSelectMode&&(this.inMultiSelectMode=!1,this._signal("singleSelect"),this.session.$undoSelect=!0,this.rangeList.detach(this.session)),t=t||this.ranges[0],t&&!t.isEqual(this.getRange())&&this.fromOrientedRange(t);},this.$initRangeList=function(){if(this.rangeList)return;this.rangeList=new r,this.ranges=[],this.rangeCount=0;},this.getAllRanges=function(){return this.rangeCount?this.rangeList.ranges.concat():[this.getRange()]},this.splitIntoLines=function(){var e=this.ranges.length?this.ranges:[this.getRange()],t=[];for(var n=0;n<e.length;n++){var r=e[n],s=r.start.row,o=r.end.row;if(s===o)t.push(r.clone());else {t.push(new i(s,r.start.column,s,this.session.getLine(s).length));while(++s<o)t.push(this.getLineRange(s,!0));t.push(new i(o,0,o,r.end.column));}n==0&&!this.isBackwards()&&(t=t.reverse());}this.toSingleRange();for(var n=t.length;n--;)this.addRange(t[n]);},this.joinSelections=function(){var e=this.rangeList.ranges,t=e[e.length-1],n=i.fromPoints(e[0].start,t.end);this.toSingleRange(),this.setSelectionRange(n,t.cursor==t.start);},this.toggleBlockSelection=function(){if(this.rangeCount>1){var e=this.rangeList.ranges,t=e[e.length-1],n=i.fromPoints(e[0].start,t.end);this.toSingleRange(),this.setSelectionRange(n,t.cursor==t.start);}else {var r=this.session.documentToScreenPosition(this.cursor),s=this.session.documentToScreenPosition(this.anchor),o=this.rectangularRangeBlock(r,s);o.forEach(this.addRange,this);}},this.rectangularRangeBlock=function(e,t,n){var r=[],s=e.column<t.column;if(s)var o=e.column,u=t.column,a=e.offsetX,f=t.offsetX;else var o=t.column,u=e.column,a=t.offsetX,f=e.offsetX;var l=e.row<t.row;if(l)var c=e.row,h=t.row;else var c=t.row,h=e.row;o<0&&(o=0),c<0&&(c=0),c==h&&(n=!0);var p;for(var d=c;d<=h;d++){var m=i.fromPoints(this.session.screenToDocumentPosition(d,o,a),this.session.screenToDocumentPosition(d,u,f));if(m.isEmpty()){if(p&&v(m.end,p))break;p=m.end;}m.cursor=s?m.start:m.end,r.push(m);}l&&r.reverse();if(!n){var g=r.length-1;while(r[g].isEmpty()&&g>0)g--;if(g>0){var y=0;while(r[y].isEmpty())y++;}for(var b=g;b>=y;b--)r[b].isEmpty()&&r.splice(b,1);}return r};}.call(s.prototype);var d=e("./editor").Editor;((function(){this.updateSelectionMarkers=function(){this.renderer.updateCursor(),this.renderer.updateBackMarkers();},this.addSelectionMarker=function(e){e.cursor||(e.cursor=e.end);var t=this.getSelectionStyle();return e.marker=this.session.addMarker(e,"ace_selection",t),this.session.$selectionMarkers.push(e),this.session.selectionMarkerCount=this.session.$selectionMarkers.length,e},this.removeSelectionMarker=function(e){if(!e.marker)return;this.session.removeMarker(e.marker);var t=this.session.$selectionMarkers.indexOf(e);t!=-1&&this.session.$selectionMarkers.splice(t,1),this.session.selectionMarkerCount=this.session.$selectionMarkers.length;},this.removeSelectionMarkers=function(e){var t=this.session.$selectionMarkers;for(var n=e.length;n--;){var r=e[n];if(!r.marker)continue;this.session.removeMarker(r.marker);var i=t.indexOf(r);i!=-1&&t.splice(i,1);}this.session.selectionMarkerCount=t.length;},this.$onAddRange=function(e){this.addSelectionMarker(e.range),this.renderer.updateCursor(),this.renderer.updateBackMarkers();},this.$onRemoveRange=function(e){this.removeSelectionMarkers(e.ranges),this.renderer.updateCursor(),this.renderer.updateBackMarkers();},this.$onMultiSelect=function(e){if(this.inMultiSelectMode)return;this.inMultiSelectMode=!0,this.setStyle("ace_multiselect"),this.keyBinding.addKeyboardHandler(f.keyboardHandler),this.commands.setDefaultHandler("exec",this.$onMultiSelectExec),this.renderer.updateCursor(),this.renderer.updateBackMarkers();},this.$onSingleSelect=function(e){if(this.session.multiSelect.inVirtualMode)return;this.inMultiSelectMode=!1,this.unsetStyle("ace_multiselect"),this.keyBinding.removeKeyboardHandler(f.keyboardHandler),this.commands.removeDefaultHandler("exec",this.$onMultiSelectExec),this.renderer.updateCursor(),this.renderer.updateBackMarkers(),this._emit("changeSelection");},this.$onMultiSelectExec=function(e){var t=e.command,n=e.editor;if(!n.multiSelect)return;if(!t.multiSelectAction){var r=t.exec(n,e.args||{});n.multiSelect.addRange(n.multiSelect.toOrientedRange()),n.multiSelect.mergeOverlappingRanges();}else t.multiSelectAction=="forEach"?r=n.forEachSelection(t,e.args):t.multiSelectAction=="forEachLine"?r=n.forEachSelection(t,e.args,!0):t.multiSelectAction=="single"?(n.exitMultiSelectMode(),r=t.exec(n,e.args||{})):r=t.multiSelectAction(n,e.args||{});return r},this.forEachSelection=function(e,t,n){if(this.inVirtualSelectionMode)return;var r=n&&n.keepOrder,i=n==1||n&&n.$byLines,o=this.session,u=this.selection,a=u.rangeList,f=(r?u:a).ranges,l;if(!f.length)return e.exec?e.exec(this,t||{}):e(this,t||{});var c=u._eventRegistry;u._eventRegistry={};var h=new s(o);this.inVirtualSelectionMode=!0;for(var p=f.length;p--;){if(i)while(p>0&&f[p].start.row==f[p-1].end.row)p--;h.fromOrientedRange(f[p]),h.index=p,this.selection=o.selection=h;var d=e.exec?e.exec(this,t||{}):e(this,t||{});!l&&d!==undefined&&(l=d),h.toOrientedRange(f[p]);}h.detach(),this.selection=o.selection=u,this.inVirtualSelectionMode=!1,u._eventRegistry=c,u.mergeOverlappingRanges(),u.ranges[0]&&u.fromOrientedRange(u.ranges[0]);var v=this.renderer.$scrollAnimation;return this.onCursorChange(),this.onSelectionChange(),v&&v.from==v.to&&this.renderer.animateScrolling(v.from),l},this.exitMultiSelectMode=function(){if(!this.inMultiSelectMode||this.inVirtualSelectionMode)return;this.multiSelect.toSingleRange();},this.getSelectedText=function(){var e="";if(this.inMultiSelectMode&&!this.inVirtualSelectionMode){var t=this.multiSelect.rangeList.ranges,n=[];for(var r=0;r<t.length;r++)n.push(this.session.getTextRange(t[r]));var i=this.session.getDocument().getNewLineCharacter();e=n.join(i),e.length==(n.length-1)*i.length&&(e="");}else this.selection.isEmpty()||(e=this.session.getTextRange(this.getSelectionRange()));return e},this.$checkMultiselectChange=function(e,t){if(this.inMultiSelectMode&&!this.inVirtualSelectionMode){var n=this.multiSelect.ranges[0];if(this.multiSelect.isEmpty()&&t==this.multiSelect.anchor)return;var r=t==this.multiSelect.anchor?n.cursor==n.start?n.end:n.start:n.cursor;r.row!=t.row||this.session.$clipPositionToDocument(r.row,r.column).column!=t.column?this.multiSelect.toSingleRange(this.multiSelect.toOrientedRange()):this.multiSelect.mergeOverlappingRanges();}},this.findAll=function(e,t,n){t=t||{},t.needle=e||t.needle;if(t.needle==undefined){var r=this.selection.isEmpty()?this.selection.getWordRange():this.selection.getRange();t.needle=this.session.getTextRange(r);}this.$search.set(t);var i=this.$search.findAll(this.session);if(!i.length)return 0;var s=this.multiSelect;n||s.toSingleRange(i[0]);for(var o=i.length;o--;)s.addRange(i[o],!0);return r&&s.rangeList.rangeAtPoint(r.start)&&s.addRange(r,!0),i.length},this.selectMoreLines=function(e,t){var n=this.selection.toOrientedRange(),r=n.cursor==n.end,s=this.session.documentToScreenPosition(n.cursor);this.selection.$desiredColumn&&(s.column=this.selection.$desiredColumn);var o=this.session.screenToDocumentPosition(s.row+e,s.column);if(!n.isEmpty())var u=this.session.documentToScreenPosition(r?n.end:n.start),a=this.session.screenToDocumentPosition(u.row+e,u.column);else var a=o;if(r){var f=i.fromPoints(o,a);f.cursor=f.start;}else {var f=i.fromPoints(a,o);f.cursor=f.end;}f.desiredColumn=s.column;if(!this.selection.inMultiSelectMode)this.selection.addRange(n);else if(t)var l=n.cursor;this.selection.addRange(f),l&&this.selection.substractPoint(l);},this.transposeSelections=function(e){var t=this.session,n=t.multiSelect,r=n.ranges;for(var i=r.length;i--;){var s=r[i];if(s.isEmpty()){var o=t.getWordRange(s.start.row,s.start.column);s.start.row=o.start.row,s.start.column=o.start.column,s.end.row=o.end.row,s.end.column=o.end.column;}}n.mergeOverlappingRanges();var u=[];for(var i=r.length;i--;){var s=r[i];u.unshift(t.getTextRange(s));}e<0?u.unshift(u.pop()):u.push(u.shift());for(var i=r.length;i--;){var s=r[i],o=s.clone();t.replace(s,u[i]),s.start.row=o.start.row,s.start.column=o.start.column;}n.fromOrientedRange(n.ranges[0]);},this.selectMore=function(e,t,n){var r=this.session,i=r.multiSelect,s=i.toOrientedRange();if(s.isEmpty()){s=r.getWordRange(s.start.row,s.start.column),s.cursor=e==-1?s.start:s.end,this.multiSelect.addRange(s);if(n)return}var o=r.getTextRange(s),u=h(r,o,e);u&&(u.cursor=e==-1?u.start:u.end,this.session.unfold(u),this.multiSelect.addRange(u),this.renderer.scrollCursorIntoView(null,.5)),t&&this.multiSelect.substractPoint(s.cursor);},this.alignCursors=function(){var e=this.session,t=e.multiSelect,n=t.ranges,r=-1,s=n.filter(function(e){if(e.cursor.row==r)return !0;r=e.cursor.row;});if(!n.length||s.length==n.length-1){var o=this.selection.getRange(),u=o.start.row,f=o.end.row,l=u==f;if(l){var c=this.session.getLength(),h;do h=this.session.getLine(f);while(/[=:]/.test(h)&&++f<c);do h=this.session.getLine(u);while(/[=:]/.test(h)&&--u>0);u<0&&(u=0),f>=c&&(f=c-1);}var p=this.session.removeFullLines(u,f);p=this.$reAlignText(p,l),this.session.insert({row:u,column:0},p.join("\n")+"\n"),l||(o.start.column=0,o.end.column=p[p.length-1].length),this.selection.setRange(o);}else {s.forEach(function(e){t.substractPoint(e.cursor);});var d=0,v=Infinity,m=n.map(function(t){var n=t.cursor,r=e.getLine(n.row),i=r.substr(n.column).search(/\S/g);return i==-1&&(i=0),n.column>d&&(d=n.column),i<v&&(v=i),i});n.forEach(function(t,n){var r=t.cursor,s=d-r.column,o=m[n]-v;s>o?e.insert(r,a.stringRepeat(" ",s-o)):e.remove(new i(r.row,r.column,r.row,r.column-s+o)),t.start.column=t.end.column=d,t.start.row=t.end.row=r.row,t.cursor=t.end;}),t.fromOrientedRange(n[0]),this.renderer.updateCursor(),this.renderer.updateBackMarkers();}},this.$reAlignText=function(e,t){function u(e){return a.stringRepeat(" ",e)}function f(e){return e[2]?u(i)+e[2]+u(s-e[2].length+o)+e[4].replace(/^([=:])\s+/,"$1 "):e[0]}function l(e){return e[2]?u(i+s-e[2].length)+e[2]+u(o)+e[4].replace(/^([=:])\s+/,"$1 "):e[0]}function c(e){return e[2]?u(i)+e[2]+u(o)+e[4].replace(/^([=:])\s+/,"$1 "):e[0]}var n=!0,r=!0,i,s,o;return e.map(function(e){var t=e.match(/(\s*)(.*?)(\s*)([=:].*)/);return t?i==null?(i=t[1].length,s=t[2].length,o=t[3].length,t):(i+s+o!=t[1].length+t[2].length+t[3].length&&(r=!1),i!=t[1].length&&(n=!1),i>t[1].length&&(i=t[1].length),s<t[2].length&&(s=t[2].length),o>t[3].length&&(o=t[3].length),t):[e]}).map(t?f:n?r?l:f:c)};})).call(d.prototype),t.onSessionChange=function(e){var t=e.session;t&&!t.multiSelect&&(t.$selectionMarkers=[],t.selection.$initRangeList(),t.multiSelect=t.selection),this.multiSelect=t&&t.multiSelect;var n=e.oldSession;n&&(n.multiSelect.off("addRange",this.$onAddRange),n.multiSelect.off("removeRange",this.$onRemoveRange),n.multiSelect.off("multiSelect",this.$onMultiSelect),n.multiSelect.off("singleSelect",this.$onSingleSelect),n.multiSelect.lead.off("change",this.$checkMultiselectChange),n.multiSelect.anchor.off("change",this.$checkMultiselectChange)),t&&(t.multiSelect.on("addRange",this.$onAddRange),t.multiSelect.on("removeRange",this.$onRemoveRange),t.multiSelect.on("multiSelect",this.$onMultiSelect),t.multiSelect.on("singleSelect",this.$onSingleSelect),t.multiSelect.lead.on("change",this.$checkMultiselectChange),t.multiSelect.anchor.on("change",this.$checkMultiselectChange)),t&&this.inMultiSelectMode!=t.selection.inMultiSelectMode&&(t.selection.inMultiSelectMode?this.$onMultiSelect():this.$onSingleSelect());},t.MultiSelect=m,e("./config").defineOptions(d.prototype,"editor",{enableMultiselect:{set:function(e){m(this),e?this.on("mousedown",o):this.off("mousedown",o);},value:!0},enableBlockSelect:{set:function(e){this.$blockSelectEnabled=e;},value:!0}});}),ace.define("ace/mode/folding/fold_mode",["require","exports","module","ace/range"],function(e,t,n){var r=e("../../range").Range,i=t.FoldMode=function(){};(function(){this.foldingStartMarker=null,this.foldingStopMarker=null,this.getFoldWidget=function(e,t,n){var r=e.getLine(n);return this.foldingStartMarker.test(r)?"start":t=="markbeginend"&&this.foldingStopMarker&&this.foldingStopMarker.test(r)?"end":""},this.getFoldWidgetRange=function(e,t,n){return null},this.indentationBlock=function(e,t,n){var i=/\S/,s=e.getLine(t),o=s.search(i);if(o==-1)return;var u=n||s.length,a=e.getLength(),f=t,l=t;while(++t<a){var c=e.getLine(t).search(i);if(c==-1)continue;if(c<=o){var h=e.getTokenAt(t,0);if(!h||h.type!=="string")break}l=t;}if(l>f){var p=e.getLine(l).length;return new r(f,u,l,p)}},this.openingBracketBlock=function(e,t,n,i,s){var o={row:n,column:i+1},u=e.$findClosingBracket(t,o,s);if(!u)return;var a=e.foldWidgets[u.row];return a==null&&(a=e.getFoldWidget(u.row)),a=="start"&&u.row>o.row&&(u.row--,u.column=e.getLine(u.row).length),r.fromPoints(o,u)},this.closingBracketBlock=function(e,t,n,i,s){var o={row:n,column:i},u=e.$findOpeningBracket(t,o);if(!u)return;return u.column++,o.column--,r.fromPoints(u,o)};}).call(i.prototype);}),ace.define("ace/ext/error_marker",["require","exports","module","ace/line_widgets","ace/lib/dom","ace/range","ace/config"],function(e,t,n){function u(e,t,n){var r=0,i=e.length-1;while(r<=i){var s=r+i>>1,o=n(t,e[s]);if(o>0)r=s+1;else {if(!(o<0))return s;i=s-1;}}return -(r+1)}function a(e,t,n){var r=e.getAnnotations().sort(s.comparePoints);if(!r.length)return;var i=u(r,{row:t,column:-1},s.comparePoints);i<0&&(i=-i-1),i>=r.length?i=n>0?0:r.length-1:i===0&&n<0&&(i=r.length-1);var o=r[i];if(!o||!n)return;if(o.row===t){do o=r[i+=n];while(o&&o.row===t);if(!o)return r.slice()}var a=[];t=o.row;do a[n<0?"unshift":"push"](o),o=r[i+=n];while(o&&o.row==t);return a.length&&a}var r=e("../line_widgets").LineWidgets,i=e("../lib/dom"),s=e("../range").Range,o=e("../config").nls;t.showErrorMarker=function(e,t){var n=e.session;n.widgetManager||(n.widgetManager=new r(n),n.widgetManager.attach(e));var s=e.getCursorPosition(),u=s.row,f=n.widgetManager.getWidgetsAtRow(u).filter(function(e){return e.type=="errorMarker"})[0];f?f.destroy():u-=t;var l=a(n,u,t),c;if(l){var h=l[0];s.column=(h.pos&&typeof h.column!="number"?h.pos.sc:h.column)||0,s.row=h.row,c=e.renderer.$gutterLayer.$annotations[s.row];}else {if(f)return;c={text:[o("Looks good!")],className:"ace_ok"};}e.session.unfold(s.row),e.selection.moveToPosition(s);var p={row:s.row,fixedWidth:!0,coverGutter:!0,el:i.createElement("div"),type:"errorMarker"},d=p.el.appendChild(i.createElement("div")),v=p.el.appendChild(i.createElement("div"));v.className="error_widget_arrow "+c.className;var m=e.renderer.$cursorLayer.getPixelPosition(s).left;v.style.left=m+e.renderer.gutterWidth-5+"px",p.el.className="error_widget_wrapper",d.className="error_widget "+c.className,d.innerHTML=c.text.join("<br>"),d.appendChild(i.createElement("div"));var g=function(e,t,n){if(t===0&&(n==="esc"||n==="return"))return p.destroy(),{command:"null"}};p.destroy=function(){if(e.$mouseHandler.isMousePressed)return;e.keyBinding.removeKeyboardHandler(g),n.widgetManager.removeLineWidget(p),e.off("changeSelection",p.destroy),e.off("changeSession",p.destroy),e.off("mouseup",p.destroy),e.off("change",p.destroy);},e.keyBinding.addKeyboardHandler(g),e.on("changeSelection",p.destroy),e.on("changeSession",p.destroy),e.on("mouseup",p.destroy),e.on("change",p.destroy),e.session.widgetManager.addLineWidget(p),p.el.onmousedown=e.focus.bind(e),e.renderer.scrollCursorIntoView(null,.5,{bottom:p.el.offsetHeight});},i.importCssString("\n    .error_widget_wrapper {\n        background: inherit;\n        color: inherit;\n        border:none\n    }\n    .error_widget {\n        border-top: solid 2px;\n        border-bottom: solid 2px;\n        margin: 5px 0;\n        padding: 10px 40px;\n        white-space: pre-wrap;\n    }\n    .error_widget.ace_error, .error_widget_arrow.ace_error{\n        border-color: #ff5a5a\n    }\n    .error_widget.ace_warning, .error_widget_arrow.ace_warning{\n        border-color: #F1D817\n    }\n    .error_widget.ace_info, .error_widget_arrow.ace_info{\n        border-color: #5a5a5a\n    }\n    .error_widget.ace_ok, .error_widget_arrow.ace_ok{\n        border-color: #5aaa5a\n    }\n    .error_widget_arrow {\n        position: absolute;\n        border: solid 5px;\n        border-top-color: transparent!important;\n        border-right-color: transparent!important;\n        border-left-color: transparent!important;\n        top: -5px;\n    }\n","error_marker.css",!1);}),ace.define("ace/ace",["require","exports","module","ace/lib/dom","ace/range","ace/editor","ace/edit_session","ace/undomanager","ace/virtual_renderer","ace/worker/worker_client","ace/keyboard/hash_handler","ace/placeholder","ace/multi_select","ace/mode/folding/fold_mode","ace/theme/textmate","ace/ext/error_marker","ace/config","ace/loader_build"],function(e,t,n){e("./loader_build")(t);var r=e("./lib/dom"),i=e("./range").Range,s=e("./editor").Editor,o=e("./edit_session").EditSession,u=e("./undomanager").UndoManager,a=e("./virtual_renderer").VirtualRenderer;e("./worker/worker_client"),e("./keyboard/hash_handler"),e("./placeholder"),e("./multi_select"),e("./mode/folding/fold_mode"),e("./theme/textmate"),e("./ext/error_marker"),t.config=e("./config"),t.edit=function(e,n){if(typeof e=="string"){var i=e;e=document.getElementById(i);if(!e)throw new Error("ace.edit can't find div #"+i)}if(e&&e.env&&e.env.editor instanceof s)return e.env.editor;var o="";if(e&&/input|textarea/i.test(e.tagName)){var u=e;o=u.value,e=r.createElement("pre"),u.parentNode.replaceChild(e,u);}else e&&(o=e.textContent,e.innerHTML="");var f=t.createEditSession(o),l=new s(new a(e),f,n),c={document:f,editor:l,onResize:l.resize.bind(l,null)};return u&&(c.textarea=u),l.on("destroy",function(){c.editor.container.env=null;}),l.container.env=l.env=c,l},t.createEditSession=function(e,t){var n=new o(e,t);return n.setUndoManager(new u),n},t.Range=i,t.Editor=s,t.EditSession=o,t.UndoManager=u,t.VirtualRenderer=a,t.version=t.config.version;});            (function() {
	                ace.require(["ace/ace"], function(a) {
	                    if (a) {
	                        a.config.init(true);
	                        a.define = ace.define;
	                    }
	                    var global = (function () {
	                        return this;
	                    })();
	                    if (!global && typeof window != "undefined") global = window; // can happen in strict mode
	                    if (!global && typeof self != "undefined") global = self; // can happen in webworker
	                    
	                    if (!global.ace)
	                        global.ace = a;
	                    for (var key in a) if (a.hasOwnProperty(key))
	                        global.ace[key] = a[key];
	                    global.ace["default"] = global.ace;
	                    if (module) {
	                        module.exports = global.ace;
	                    }
	                });
	            })();
	}(ace$2));

	var ace$1 = ace$2.exports;

	var modeJavascript = {exports: {}};

	(function (module, exports) {
	ace.define("ace/mode/jsdoc_comment_highlight_rules",["require","exports","module","ace/lib/oop","ace/mode/text_highlight_rules"],function(e,t,n){var r=e("../lib/oop"),i=e("./text_highlight_rules").TextHighlightRules,s=function(){this.$rules={start:[{token:["comment.doc.tag","comment.doc.text","lparen.doc"],regex:"(@(?:param|member|typedef|property|namespace|var|const|callback))(\\s*)({)",push:[{token:"lparen.doc",regex:"{",push:[{include:"doc-syntax"},{token:"rparen.doc",regex:"}|(?=$)",next:"pop"}]},{token:["rparen.doc","text.doc","variable.parameter.doc","lparen.doc","variable.parameter.doc","rparen.doc"],regex:/(})(\s*)(?:([\w=:\/\.]+)|(?:(\[)([\w=:\/\.]+)(\])))/,next:"pop"},{token:"rparen.doc",regex:"}|(?=$)",next:"pop"},{include:"doc-syntax"},{defaultToken:"text.doc"}]},{token:["comment.doc.tag","text.doc","lparen.doc"],regex:"(@(?:returns?|yields|type|this|suppress|public|protected|private|package|modifies|implements|external|exception|throws|enum|define|extends))(\\s*)({)",push:[{token:"lparen.doc",regex:"{",push:[{include:"doc-syntax"},{token:"rparen.doc",regex:"}|(?=$)",next:"pop"}]},{token:"rparen.doc",regex:"}|(?=$)",next:"pop"},{include:"doc-syntax"},{defaultToken:"text.doc"}]},{token:["comment.doc.tag","text.doc","variable.parameter.doc"],regex:'(@(?:alias|memberof|instance|module|name|lends|namespace|external|this|template|requires|param|implements|function|extends|typedef|mixes|constructor|var|memberof\\!|event|listens|exports|class|constructs|interface|emits|fires|throws|const|callback|borrows|augments))(\\s+)(\\w[\\w#.:/~"\\-]*)?'},{token:["comment.doc.tag","text.doc","variable.parameter.doc"],regex:"(@method)(\\s+)(\\w[\\w.\\(\\)]*)"},{token:"comment.doc.tag",regex:"@access\\s+(?:private|public|protected)"},{token:"comment.doc.tag",regex:"@kind\\s+(?:class|constant|event|external|file|function|member|mixin|module|namespace|typedef)"},{token:"comment.doc.tag",regex:"@\\w+(?=\\s|$)"},s.getTagRule(),{defaultToken:"comment.doc",caseInsensitive:!0}],"doc-syntax":[{token:"operator.doc",regex:/[|:]/},{token:"paren.doc",regex:/[\[\]]/}]},this.normalizeRules();};r.inherits(s,i),s.getTagRule=function(e){return {token:"comment.doc.tag.storage.type",regex:"\\b(?:TODO|FIXME|XXX|HACK)\\b"}},s.getStartRule=function(e){return {token:"comment.doc",regex:"\\/\\*(?=\\*)",next:e}},s.getEndRule=function(e){return {token:"comment.doc",regex:"\\*\\/",next:e}},t.JsDocCommentHighlightRules=s;}),ace.define("ace/mode/javascript_highlight_rules",["require","exports","module","ace/lib/oop","ace/mode/jsdoc_comment_highlight_rules","ace/mode/text_highlight_rules"],function(e,t,n){function a(){var e=o.replace("\\d","\\d\\-"),t={onMatch:function(e,t,n){var r=e.charAt(1)=="/"?2:1;if(r==1)t!=this.nextState?n.unshift(this.next,this.nextState,0):n.unshift(this.next),n[2]++;else if(r==2&&t==this.nextState){n[1]--;if(!n[1]||n[1]<0)n.shift(),n.shift();}return [{type:"meta.tag.punctuation."+(r==1?"":"end-")+"tag-open.xml",value:e.slice(0,r)},{type:"meta.tag.tag-name.xml",value:e.substr(r)}]},regex:"</?"+e+"",next:"jsxAttributes",nextState:"jsx"};this.$rules.start.unshift(t);var n={regex:"{",token:"paren.quasi.start",push:"start"};this.$rules.jsx=[n,t,{include:"reference"},{defaultToken:"string"}],this.$rules.jsxAttributes=[{token:"meta.tag.punctuation.tag-close.xml",regex:"/?>",onMatch:function(e,t,n){return t==n[0]&&n.shift(),e.length==2&&(n[0]==this.nextState&&n[1]--,(!n[1]||n[1]<0)&&n.splice(0,2)),this.next=n[0]||"start",[{type:this.token,value:e}]},nextState:"jsx"},n,f("jsxAttributes"),{token:"entity.other.attribute-name.xml",regex:e},{token:"keyword.operator.attribute-equals.xml",regex:"="},{token:"text.tag-whitespace.xml",regex:"\\s+"},{token:"string.attribute-value.xml",regex:"'",stateName:"jsx_attr_q",push:[{token:"string.attribute-value.xml",regex:"'",next:"pop"},{include:"reference"},{defaultToken:"string.attribute-value.xml"}]},{token:"string.attribute-value.xml",regex:'"',stateName:"jsx_attr_qq",push:[{token:"string.attribute-value.xml",regex:'"',next:"pop"},{include:"reference"},{defaultToken:"string.attribute-value.xml"}]},t],this.$rules.reference=[{token:"constant.language.escape.reference.xml",regex:"(?:&#[0-9]+;)|(?:&#x[0-9a-fA-F]+;)|(?:&[a-zA-Z0-9_:\\.-]+;)"}];}function f(e){return [{token:"comment",regex:/\/\*/,next:[i.getTagRule(),{token:"comment",regex:"\\*\\/",next:e||"pop"},{defaultToken:"comment",caseInsensitive:!0}]},{token:"comment",regex:"\\/\\/",next:[i.getTagRule(),{token:"comment",regex:"$|^",next:e||"pop"},{defaultToken:"comment",caseInsensitive:!0}]}]}var r=e("../lib/oop"),i=e("./jsdoc_comment_highlight_rules").JsDocCommentHighlightRules,s=e("./text_highlight_rules").TextHighlightRules,o="[a-zA-Z\\$_\u00a1-\uffff][a-zA-Z\\d\\$_\u00a1-\uffff]*",u=function(e){var t=this.createKeywordMapper({"variable.language":"Array|Boolean|Date|Function|Iterator|Number|Object|RegExp|String|Proxy|Symbol|Namespace|QName|XML|XMLList|ArrayBuffer|Float32Array|Float64Array|Int16Array|Int32Array|Int8Array|Uint16Array|Uint32Array|Uint8Array|Uint8ClampedArray|Error|EvalError|InternalError|RangeError|ReferenceError|StopIteration|SyntaxError|TypeError|URIError|decodeURI|decodeURIComponent|encodeURI|encodeURIComponent|eval|isFinite|isNaN|parseFloat|parseInt|JSON|Math|this|arguments|prototype|window|document",keyword:"const|yield|import|get|set|async|await|break|case|catch|continue|default|delete|do|else|finally|for|function|if|in|of|instanceof|new|return|switch|throw|try|typeof|let|var|while|with|debugger|__parent__|__count__|escape|unescape|with|__proto__|class|enum|extends|super|export|implements|private|public|interface|package|protected|static|constructor","storage.type":"const|let|var|function","constant.language":"null|Infinity|NaN|undefined","support.function":"alert","constant.language.boolean":"true|false"},"identifier"),n="case|do|else|finally|in|instanceof|return|throw|try|typeof|yield|void",r="\\\\(?:x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|u{[0-9a-fA-F]{1,6}}|[0-2][0-7]{0,2}|3[0-7][0-7]?|[4-7][0-7]?|.)";this.$rules={no_regex:[i.getStartRule("doc-start"),f("no_regex"),{token:"string",regex:"'(?=.)",next:"qstring"},{token:"string",regex:'"(?=.)',next:"qqstring"},{token:"constant.numeric",regex:/0(?:[xX][0-9a-fA-F]+|[oO][0-7]+|[bB][01]+)\b/},{token:"constant.numeric",regex:/(?:\d\d*(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+\b)?/},{token:["storage.type","punctuation.operator","support.function","punctuation.operator","entity.name.function","text","keyword.operator"],regex:"("+o+")(\\.)(prototype)(\\.)("+o+")(\\s*)(=)",next:"function_arguments"},{token:["storage.type","punctuation.operator","entity.name.function","text","keyword.operator","text","storage.type","text","paren.lparen"],regex:"("+o+")(\\.)("+o+")(\\s*)(=)(\\s*)(function\\*?)(\\s*)(\\()",next:"function_arguments"},{token:["entity.name.function","text","keyword.operator","text","storage.type","text","paren.lparen"],regex:"("+o+")(\\s*)(=)(\\s*)(function\\*?)(\\s*)(\\()",next:"function_arguments"},{token:["storage.type","punctuation.operator","entity.name.function","text","keyword.operator","text","storage.type","text","entity.name.function","text","paren.lparen"],regex:"("+o+")(\\.)("+o+")(\\s*)(=)(\\s*)(function\\*?)(\\s+)(\\w+)(\\s*)(\\()",next:"function_arguments"},{token:["storage.type","text","entity.name.function","text","paren.lparen"],regex:"(function\\*?)(\\s+)("+o+")(\\s*)(\\()",next:"function_arguments"},{token:["entity.name.function","text","punctuation.operator","text","storage.type","text","paren.lparen"],regex:"("+o+")(\\s*)(:)(\\s*)(function\\*?)(\\s*)(\\()",next:"function_arguments"},{token:["text","text","storage.type","text","paren.lparen"],regex:"(:)(\\s*)(function\\*?)(\\s*)(\\()",next:"function_arguments"},{token:"keyword",regex:"from(?=\\s*('|\"))"},{token:"keyword",regex:"(?:"+n+")\\b",next:"start"},{token:"support.constant",regex:/that\b/},{token:["storage.type","punctuation.operator","support.function.firebug"],regex:/(console)(\.)(warn|info|log|error|time|trace|timeEnd|assert)\b/},{token:t,regex:o},{token:"punctuation.operator",regex:/[.](?![.])/,next:"property"},{token:"storage.type",regex:/=>/,next:"start"},{token:"keyword.operator",regex:/--|\+\+|\.{3}|===|==|=|!=|!==|<+=?|>+=?|!|&&|\|\||\?:|[!$%&*+\-~\/^]=?/,next:"start"},{token:"punctuation.operator",regex:/[?:,;.]/,next:"start"},{token:"paren.lparen",regex:/[\[({]/,next:"start"},{token:"paren.rparen",regex:/[\])}]/},{token:"comment",regex:/^#!.*$/}],property:[{token:"text",regex:"\\s+"},{token:["storage.type","punctuation.operator","entity.name.function","text","keyword.operator","text","storage.type","text","entity.name.function","text","paren.lparen"],regex:"("+o+")(\\.)("+o+")(\\s*)(=)(\\s*)(function\\*?)(?:(\\s+)(\\w+))?(\\s*)(\\()",next:"function_arguments"},{token:"punctuation.operator",regex:/[.](?![.])/},{token:"support.function",regex:/(s(?:h(?:ift|ow(?:Mod(?:elessDialog|alDialog)|Help))|croll(?:X|By(?:Pages|Lines)?|Y|To)?|t(?:op|rike)|i(?:n|zeToContent|debar|gnText)|ort|u(?:p|b(?:str(?:ing)?)?)|pli(?:ce|t)|e(?:nd|t(?:Re(?:sizable|questHeader)|M(?:i(?:nutes|lliseconds)|onth)|Seconds|Ho(?:tKeys|urs)|Year|Cursor|Time(?:out)?|Interval|ZOptions|Date|UTC(?:M(?:i(?:nutes|lliseconds)|onth)|Seconds|Hours|Date|FullYear)|FullYear|Active)|arch)|qrt|lice|avePreferences|mall)|h(?:ome|andleEvent)|navigate|c(?:har(?:CodeAt|At)|o(?:s|n(?:cat|textual|firm)|mpile)|eil|lear(?:Timeout|Interval)?|a(?:ptureEvents|ll)|reate(?:StyleSheet|Popup|EventObject))|t(?:o(?:GMTString|S(?:tring|ource)|U(?:TCString|pperCase)|Lo(?:caleString|werCase))|est|a(?:n|int(?:Enabled)?))|i(?:s(?:NaN|Finite)|ndexOf|talics)|d(?:isableExternalCapture|ump|etachEvent)|u(?:n(?:shift|taint|escape|watch)|pdateCommands)|j(?:oin|avaEnabled)|p(?:o(?:p|w)|ush|lugins.refresh|a(?:ddings|rse(?:Int|Float)?)|r(?:int|ompt|eference))|e(?:scape|nableExternalCapture|val|lementFromPoint|x(?:p|ec(?:Script|Command)?))|valueOf|UTC|queryCommand(?:State|Indeterm|Enabled|Value)|f(?:i(?:nd|lter|le(?:ModifiedDate|Size|CreatedDate|UpdatedDate)|xed)|o(?:nt(?:size|color)|rward|rEach)|loor|romCharCode)|watch|l(?:ink|o(?:ad|g)|astIndexOf)|a(?:sin|nchor|cos|t(?:tachEvent|ob|an(?:2)?)|pply|lert|b(?:s|ort))|r(?:ou(?:nd|teEvents)|e(?:size(?:By|To)|calc|turnValue|place|verse|l(?:oad|ease(?:Capture|Events)))|andom)|g(?:o|et(?:ResponseHeader|M(?:i(?:nutes|lliseconds)|onth)|Se(?:conds|lection)|Hours|Year|Time(?:zoneOffset)?|Da(?:y|te)|UTC(?:M(?:i(?:nutes|lliseconds)|onth)|Seconds|Hours|Da(?:y|te)|FullYear)|FullYear|A(?:ttention|llResponseHeaders)))|m(?:in|ove(?:B(?:y|elow)|To(?:Absolute)?|Above)|ergeAttributes|a(?:tch|rgins|x))|b(?:toa|ig|o(?:ld|rderWidths)|link|ack))\b(?=\()/},{token:"support.function.dom",regex:/(s(?:ub(?:stringData|mit)|plitText|e(?:t(?:NamedItem|Attribute(?:Node)?)|lect))|has(?:ChildNodes|Feature)|namedItem|c(?:l(?:ick|o(?:se|neNode))|reate(?:C(?:omment|DATASection|aption)|T(?:Head|extNode|Foot)|DocumentFragment|ProcessingInstruction|E(?:ntityReference|lement)|Attribute))|tabIndex|i(?:nsert(?:Row|Before|Cell|Data)|tem)|open|delete(?:Row|C(?:ell|aption)|T(?:Head|Foot)|Data)|focus|write(?:ln)?|a(?:dd|ppend(?:Child|Data))|re(?:set|place(?:Child|Data)|move(?:NamedItem|Child|Attribute(?:Node)?)?)|get(?:NamedItem|Element(?:sBy(?:Name|TagName|ClassName)|ById)|Attribute(?:Node)?)|blur)\b(?=\()/},{token:"support.constant",regex:/(s(?:ystemLanguage|cr(?:ipts|ollbars|een(?:X|Y|Top|Left))|t(?:yle(?:Sheets)?|atus(?:Text|bar)?)|ibling(?:Below|Above)|ource|uffixes|e(?:curity(?:Policy)?|l(?:ection|f)))|h(?:istory|ost(?:name)?|as(?:h|Focus))|y|X(?:MLDocument|SLDocument)|n(?:ext|ame(?:space(?:s|URI)|Prop))|M(?:IN_VALUE|AX_VALUE)|c(?:haracterSet|o(?:n(?:structor|trollers)|okieEnabled|lorDepth|mp(?:onents|lete))|urrent|puClass|l(?:i(?:p(?:boardData)?|entInformation)|osed|asses)|alle(?:e|r)|rypto)|t(?:o(?:olbar|p)|ext(?:Transform|Indent|Decoration|Align)|ags)|SQRT(?:1_2|2)|i(?:n(?:ner(?:Height|Width)|put)|ds|gnoreCase)|zIndex|o(?:scpu|n(?:readystatechange|Line)|uter(?:Height|Width)|p(?:sProfile|ener)|ffscreenBuffering)|NEGATIVE_INFINITY|d(?:i(?:splay|alog(?:Height|Top|Width|Left|Arguments)|rectories)|e(?:scription|fault(?:Status|Ch(?:ecked|arset)|View)))|u(?:ser(?:Profile|Language|Agent)|n(?:iqueID|defined)|pdateInterval)|_content|p(?:ixelDepth|ort|ersonalbar|kcs11|l(?:ugins|atform)|a(?:thname|dding(?:Right|Bottom|Top|Left)|rent(?:Window|Layer)?|ge(?:X(?:Offset)?|Y(?:Offset)?))|r(?:o(?:to(?:col|type)|duct(?:Sub)?|mpter)|e(?:vious|fix)))|e(?:n(?:coding|abledPlugin)|x(?:ternal|pando)|mbeds)|v(?:isibility|endor(?:Sub)?|Linkcolor)|URLUnencoded|P(?:I|OSITIVE_INFINITY)|f(?:ilename|o(?:nt(?:Size|Family|Weight)|rmName)|rame(?:s|Element)|gColor)|E|whiteSpace|l(?:i(?:stStyleType|n(?:eHeight|kColor))|o(?:ca(?:tion(?:bar)?|lName)|wsrc)|e(?:ngth|ft(?:Context)?)|a(?:st(?:M(?:odified|atch)|Index|Paren)|yer(?:s|X)|nguage))|a(?:pp(?:MinorVersion|Name|Co(?:deName|re)|Version)|vail(?:Height|Top|Width|Left)|ll|r(?:ity|guments)|Linkcolor|bove)|r(?:ight(?:Context)?|e(?:sponse(?:XML|Text)|adyState))|global|x|m(?:imeTypes|ultiline|enubar|argin(?:Right|Bottom|Top|Left))|L(?:N(?:10|2)|OG(?:10E|2E))|b(?:o(?:ttom|rder(?:Width|RightWidth|BottomWidth|Style|Color|TopWidth|LeftWidth))|ufferDepth|elow|ackground(?:Color|Image)))\b/},{token:"identifier",regex:o},{regex:"",token:"empty",next:"no_regex"}],start:[i.getStartRule("doc-start"),f("start"),{token:"string.regexp",regex:"\\/",next:"regex"},{token:"text",regex:"\\s+|^$",next:"start"},{token:"empty",regex:"",next:"no_regex"}],regex:[{token:"regexp.keyword.operator",regex:"\\\\(?:u[\\da-fA-F]{4}|x[\\da-fA-F]{2}|.)"},{token:"string.regexp",regex:"/[sxngimy]*",next:"no_regex"},{token:"invalid",regex:/\{\d+\b,?\d*\}[+*]|[+*$^?][+*]|[$^][?]|\?{3,}/},{token:"constant.language.escape",regex:/\(\?[:=!]|\)|\{\d+\b,?\d*\}|[+*]\?|[()$^+*?.]/},{token:"constant.language.delimiter",regex:/\|/},{token:"constant.language.escape",regex:/\[\^?/,next:"regex_character_class"},{token:"empty",regex:"$",next:"no_regex"},{defaultToken:"string.regexp"}],regex_character_class:[{token:"regexp.charclass.keyword.operator",regex:"\\\\(?:u[\\da-fA-F]{4}|x[\\da-fA-F]{2}|.)"},{token:"constant.language.escape",regex:"]",next:"regex"},{token:"constant.language.escape",regex:"-"},{token:"empty",regex:"$",next:"no_regex"},{defaultToken:"string.regexp.charachterclass"}],default_parameter:[{token:"string",regex:"'(?=.)",push:[{token:"string",regex:"'|$",next:"pop"},{include:"qstring"}]},{token:"string",regex:'"(?=.)',push:[{token:"string",regex:'"|$',next:"pop"},{include:"qqstring"}]},{token:"constant.language",regex:"null|Infinity|NaN|undefined"},{token:"constant.numeric",regex:/0(?:[xX][0-9a-fA-F]+|[oO][0-7]+|[bB][01]+)\b/},{token:"constant.numeric",regex:/(?:\d\d*(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+\b)?/},{token:"punctuation.operator",regex:",",next:"function_arguments"},{token:"text",regex:"\\s+"},{token:"punctuation.operator",regex:"$"},{token:"empty",regex:"",next:"no_regex"}],function_arguments:[f("function_arguments"),{token:"variable.parameter",regex:o},{token:"punctuation.operator",regex:","},{token:"text",regex:"\\s+"},{token:"punctuation.operator",regex:"$"},{token:"empty",regex:"",next:"no_regex"}],qqstring:[{token:"constant.language.escape",regex:r},{token:"string",regex:"\\\\$",consumeLineEnd:!0},{token:"string",regex:'"|$',next:"no_regex"},{defaultToken:"string"}],qstring:[{token:"constant.language.escape",regex:r},{token:"string",regex:"\\\\$",consumeLineEnd:!0},{token:"string",regex:"'|$",next:"no_regex"},{defaultToken:"string"}]};if(!e||!e.noES6)this.$rules.no_regex.unshift({regex:"[{}]",onMatch:function(e,t,n){this.next=e=="{"?this.nextState:"";if(e=="{"&&n.length)n.unshift("start",t);else if(e=="}"&&n.length){n.shift(),this.next=n.shift();if(this.next.indexOf("string")!=-1||this.next.indexOf("jsx")!=-1)return "paren.quasi.end"}return e=="{"?"paren.lparen":"paren.rparen"},nextState:"start"},{token:"string.quasi.start",regex:/`/,push:[{token:"constant.language.escape",regex:r},{token:"paren.quasi.start",regex:/\${/,push:"start"},{token:"string.quasi.end",regex:/`/,next:"pop"},{defaultToken:"string.quasi"}]},{token:["variable.parameter","text"],regex:"("+o+")(\\s*)(?=\\=>)"},{token:"paren.lparen",regex:"(\\()(?=.+\\s*=>)",next:"function_arguments"},{token:"variable.language",regex:"(?:(?:(?:Weak)?(?:Set|Map))|Promise)\\b"}),this.$rules.function_arguments.unshift({token:"keyword.operator",regex:"=",next:"default_parameter"},{token:"keyword.operator",regex:"\\.{3}"}),this.$rules.property.unshift({token:"support.function",regex:"(findIndex|repeat|startsWith|endsWith|includes|isSafeInteger|trunc|cbrt|log2|log10|sign|then|catch|finally|resolve|reject|race|any|all|allSettled|keys|entries|isInteger)\\b(?=\\()"},{token:"constant.language",regex:"(?:MAX_SAFE_INTEGER|MIN_SAFE_INTEGER|EPSILON)\\b"}),(!e||e.jsx!=0)&&a.call(this);this.embedRules(i,"doc-",[i.getEndRule("no_regex")]),this.normalizeRules();};r.inherits(u,s),t.JavaScriptHighlightRules=u;}),ace.define("ace/mode/matching_brace_outdent",["require","exports","module","ace/range"],function(e,t,n){var r=e("../range").Range,i=function(){};((function(){this.checkOutdent=function(e,t){return /^\s+$/.test(e)?/^\s*\}/.test(t):!1},this.autoOutdent=function(e,t){var n=e.getLine(t),i=n.match(/^(\s*\})/);if(!i)return 0;var s=i[1].length,o=e.findMatchingBracket({row:t,column:s});if(!o||o.row==t)return 0;var u=this.$getIndent(e.getLine(o.row));e.replace(new r(t,0,t,s-1),u);},this.$getIndent=function(e){return e.match(/^\s*/)[0]};})).call(i.prototype),t.MatchingBraceOutdent=i;}),ace.define("ace/mode/folding/cstyle",["require","exports","module","ace/lib/oop","ace/range","ace/mode/folding/fold_mode"],function(e,t,n){var r=e("../../lib/oop"),i=e("../../range").Range,s=e("./fold_mode").FoldMode,o=t.FoldMode=function(e){e&&(this.foldingStartMarker=new RegExp(this.foldingStartMarker.source.replace(/\|[^|]*?$/,"|"+e.start)),this.foldingStopMarker=new RegExp(this.foldingStopMarker.source.replace(/\|[^|]*?$/,"|"+e.end)));};r.inherits(o,s),function(){this.foldingStartMarker=/([\{\[\(])[^\}\]\)]*$|^\s*(\/\*)/,this.foldingStopMarker=/^[^\[\{\(]*([\}\]\)])|^[\s\*]*(\*\/)/,this.singleLineBlockCommentRe=/^\s*(\/\*).*\*\/\s*$/,this.tripleStarBlockCommentRe=/^\s*(\/\*\*\*).*\*\/\s*$/,this.startRegionRe=/^\s*(\/\*|\/\/)#?region\b/,this._getFoldWidgetBase=this.getFoldWidget,this.getFoldWidget=function(e,t,n){var r=e.getLine(n);if(this.singleLineBlockCommentRe.test(r)&&!this.startRegionRe.test(r)&&!this.tripleStarBlockCommentRe.test(r))return "";var i=this._getFoldWidgetBase(e,t,n);return !i&&this.startRegionRe.test(r)?"start":i},this.getFoldWidgetRange=function(e,t,n,r){var i=e.getLine(n);if(this.startRegionRe.test(i))return this.getCommentRegionBlock(e,i,n);var s=i.match(this.foldingStartMarker);if(s){var o=s.index;if(s[1])return this.openingBracketBlock(e,s[1],n,o);var u=e.getCommentFoldRange(n,o+s[0].length,1);return u&&!u.isMultiLine()&&(r?u=this.getSectionRange(e,n):t!="all"&&(u=null)),u}if(t==="markbegin")return;var s=i.match(this.foldingStopMarker);if(s){var o=s.index+s[0].length;return s[1]?this.closingBracketBlock(e,s[1],n,o):e.getCommentFoldRange(n,o,-1)}},this.getSectionRange=function(e,t){var n=e.getLine(t),r=n.search(/\S/),s=t,o=n.length;t+=1;var u=t,a=e.getLength();while(++t<a){n=e.getLine(t);var f=n.search(/\S/);if(f===-1)continue;if(r>f)break;var l=this.getFoldWidgetRange(e,"all",t);if(l){if(l.start.row<=s)break;if(l.isMultiLine())t=l.end.row;else if(r==f)break}u=t;}return new i(s,o,u,e.getLine(u).length)},this.getCommentRegionBlock=function(e,t,n){var r=t.search(/\s*$/),s=e.getLength(),o=n,u=/^\s*(?:\/\*|\/\/|--)#?(end)?region\b/,a=1;while(++n<s){t=e.getLine(n);var f=u.exec(t);if(!f)continue;f[1]?a--:a++;if(!a)break}var l=n;if(l>o)return new i(o,r,l,t.length)};}.call(o.prototype);}),ace.define("ace/mode/javascript",["require","exports","module","ace/lib/oop","ace/mode/text","ace/mode/javascript_highlight_rules","ace/mode/matching_brace_outdent","ace/worker/worker_client","ace/mode/behaviour/cstyle","ace/mode/folding/cstyle"],function(e,t,n){var r=e("../lib/oop"),i=e("./text").Mode,s=e("./javascript_highlight_rules").JavaScriptHighlightRules,o=e("./matching_brace_outdent").MatchingBraceOutdent,u=e("../worker/worker_client").WorkerClient,a=e("./behaviour/cstyle").CstyleBehaviour,f=e("./folding/cstyle").FoldMode,l=function(){this.HighlightRules=s,this.$outdent=new o,this.$behaviour=new a,this.foldingRules=new f;};r.inherits(l,i),function(){this.lineCommentStart="//",this.blockComment={start:"/*",end:"*/"},this.$quotes={'"':'"',"'":"'","`":"`"},this.$pairQuotesAfter={"`":/\w/},this.getNextLineIndent=function(e,t,n){var r=this.$getIndent(t),i=this.getTokenizer().getLineTokens(t,e),s=i.tokens,o=i.state;if(s.length&&s[s.length-1].type=="comment")return r;if(e=="start"||e=="no_regex"){var u=t.match(/^.*(?:\bcase\b.*:|[\{\(\[])\s*$/);u&&(r+=n);}else if(e=="doc-start"){if(o=="start"||o=="no_regex")return "";var u=t.match(/^\s*(\/?)\*/);u&&(u[1]&&(r+=" "),r+="* ");}return r},this.checkOutdent=function(e,t,n){return this.$outdent.checkOutdent(t,n)},this.autoOutdent=function(e,t,n){this.$outdent.autoOutdent(t,n);},this.createWorker=function(e){var t=new u(["ace"],"ace/mode/javascript_worker","JavaScriptWorker");return t.attachToDocument(e.getDocument()),t.on("annotate",function(t){e.setAnnotations(t.data);}),t.on("terminate",function(){e.clearAnnotations();}),t},this.$id="ace/mode/javascript",this.snippetFileId="ace/snippets/javascript";}.call(l.prototype),t.Mode=l;});                (function() {
	                    ace.require(["ace/mode/javascript"], function(m) {
	                        if (module) {
	                            module.exports = m;
	                        }
	                    });
	                })();
	}(modeJavascript));

	var themeLight = {exports: {}};

	(function (module, exports) {
	ace.define("ace/theme/light-css",["require","exports","module"],function(e,t,n){n.exports='.ace-light .ace_gutter {\n  background: var(--gutter-bg-color);\n  color: var(--gutter-text-color);\n  overflow : hidden;\n}\n\n.ace-light .ace_print-margin {\n  width: 1px;\n  background: #e8e8e8;\n}\n\n.ace-light {\n  background-color: var(--space-bg-color);\n  color: var(--space-text-color);\n}\n\n.ace-light .ace_cursor {\n  color: black;\n}\n\n.ace-light .ace_invisible {\n  color: rgb(191, 191, 191);\n}\n\n.ace-light .ace_constant.ace_buildin {\n  color: rgb(88, 72, 246);\n}\n\n.ace-light .ace_constant.ace_language {\n  color: rgb(88, 92, 246);\n}\n\n.ace-light .ace_constant.ace_library {\n  color: rgb(6, 150, 14);\n}\n\n.ace-light .ace_invalid {\n  background-color: rgb(153, 0, 0);\n  color: white;\n}\n\n.ace-light .ace_fold {\n}\n\n.ace-light .ace_support.ace_function {\n  color: rgb(60, 76, 114);\n}\n\n.ace-light .ace_support.ace_constant {\n  color: rgb(6, 150, 14);\n}\n\n.ace-light .ace_support.ace_type,\n.ace-light .ace_support.ace_class\n.ace-light .ace_support.ace_other {\n  color: rgb(109, 121, 222);\n}\n\n.ace-light .ace_variable.ace_parameter {\n  font-style:italic;\n  color:#FD971F;\n}\n.ace-light .ace_keyword.ace_operator {\n  color: rgb(104, 118, 135);\n}\n\n.ace-light .ace_comment {\n  color: #236e24;\n}\n\n.ace-light .ace_comment.ace_doc {\n  color: #236e24;\n}\n\n.ace-light .ace_comment.ace_doc.ace_tag {\n  color: #236e24;\n}\n\n.ace-light .ace_constant.ace_numeric {\n  color: rgb(0, 0, 205);\n}\n\n.ace-light .ace_variable {\n  color: rgb(49, 132, 149);\n}\n\n.ace-light .ace_xml-pe {\n  color: rgb(104, 104, 91);\n}\n\n.ace-light .ace_entity.ace_name.ace_function {\n  color: #0000A2;\n}\n\n\n.ace-light .ace_heading {\n  color: rgb(12, 7, 255);\n}\n\n.ace-light .ace_list {\n  color:rgb(185, 6, 144);\n}\n\n.ace-light .ace_marker-layer .ace_selection {\n  background: rgb(181, 213, 255);\n}\n\n.ace-light .ace_marker-layer .ace_step {\n  background: rgb(252, 255, 0);\n}\n\n.ace-light .ace_marker-layer .ace_stack {\n  background: rgb(164, 229, 101);\n}\n\n.ace-light .ace_marker-layer .ace_bracket {\n  margin: -1px 0 0 -1px;\n  border: 1px solid rgb(192, 192, 192);\n}\n\n.ace-light .ace_marker-layer .ace_active-line {\n  background: rgba(0, 0, 0, 0.07);\n}\n\n.ace-light .ace_gutter-active-line {\n    background-color : #dcdcdc;\n}\n\n.ace-light .ace_marker-layer .ace_selected-word {\n  background: rgb(250, 250, 255);\n  border: 1px solid rgb(200, 200, 250);\n}\n\n.ace-light .ace_storage,\n.ace-light .ace_keyword,\n.ace-light .ace_meta.ace_tag {\n  color: rgb(147, 15, 128);\n}\n\n.ace-light .ace_string.ace_regex {\n  color: rgb(255, 0, 0)\n}\n\n.ace-light .ace_string {\n  color: #1A1AA6;\n}\n\n.ace-light .ace_entity.ace_other.ace_attribute-name {\n  color: #994409;\n}\n\n.ace-light .ace_indent-guide {\n  background: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAACCAYAAACZgbYnAAAAE0lEQVQImWP4////f4bLly//BwAmVgd1/w11/gAAAABJRU5ErkJggg==") right repeat-y;\n}\n  \n.ace-light .ace_indent-guide-active {\n  background: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAACCAYAAACZgbYnAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAIGNIUk0AAHolAACAgwAA+f8AAIDpAAB1MAAA6mAAADqYAAAXb5JfxUYAAAAZSURBVHjaYvj///9/hivKyv8BAAAA//8DACLqBhbvk+/eAAAAAElFTkSuQmCC") right repeat-y;\n}\n';}),ace.define("ace/theme/light",["require","exports","module","ace/theme/light-css","ace/lib/dom"],function(e,t,n){t.isDark=!1,t.cssClass="ace-light",t.cssText=e("./light-css");var r=e("../lib/dom");r.importCssString(t.cssText,t.cssClass,!1);});                (function() {
	                    ace.require(["ace/theme/light"], function(m) {
	                        if (module) {
	                            module.exports = m;
	                        }
	                    });
	                })();
	}(themeLight));

	var themeDarcula = {exports: {}};

	(function (module, exports) {
	ace.define("ace/theme/darcula-css",["require","exports","module"],function(e,t,n){n.exports='\n\n.ace-darcula .ace_gutter {\n  background: var(--gutter-bg-color);\n  color: var(--gutter-text-color);\n}\n\n.ace-darcula .ace_print-margin {\n  width: 1px;\n  background: #44475a\n}\n\n.ace-darcula {\n  background-color: var(--space-bg-color);\n  color: var(--space-text-color);\n}\n\n.ace-darcula .ace_cursor {\n  color: #f8f8f0\n}\n\n.ace-darcula .ace_marker-layer .ace_selection {\n  background: #44475a\n}\n\n.ace-darcula.ace_multiselect .ace_selection.ace_start {\n  box-shadow: 0 0 3px 0px #282a36;\n  border-radius: 2px\n}\n\n.ace-darcula .ace_marker-layer .ace_step {\n  background: rgb(198, 219, 174)\n}\n\n.ace-darcula .ace_marker-layer .ace_bracket {\n  margin: -1px 0 0 -1px;\n  border: 1px solid #a29709\n}\n\n.ace-darcula .ace_marker-layer .ace_active-line {\n  background: #323232FF\n}\n\n.ace-darcula .ace_gutter-active-line {\n  background-color: #323232FF\n}\n\n.ace-darcula .ace_marker-layer .ace_selected-word {\n  box-shadow: 0px 0px 0px 1px #a29709;\n  border-radius: 3px;\n}\n\n.ace-darcula .ace_fold {\n    background-color: #3a3a3a;\n    border-color: #3a3a3a;\n    padding: 7px 15px;\n    background-image: unset;\n    position: relative;\n}\n\n.ace-darcula .ace_fold:before {\n    content: "...";\n    display: block;\n    position: absolute;\n    color: gray;\n    top: 0;\n    left: 5px;\n}\n\n.ace-darcula .ace_keyword {\n  color: #ff79c6\n}\n\n.ace-darcula .ace_constant.ace_language {\n  color: #bd93f9\n}\n\n.ace-darcula .ace_constant.ace_numeric {\n  color: #bd93f9\n}\n\n.ace-darcula .ace_constant.ace_character {\n  color: #bd93f9\n}\n\n.ace-darcula .ace_constant.ace_character.ace_escape {\n  color: #ff79c6\n}\n\n.ace-darcula .ace_constant.ace_other {\n  color: #bd93f9\n}\n\n.ace-darcula .ace_support.ace_function {\n  color: #8be9fd\n}\n\n.ace-darcula .ace_support.ace_constant {\n  color: #6be5fd\n}\n\n.ace-darcula .ace_support.ace_class {\n  font-style: italic;\n  color: #66d9ef\n}\n\n.ace-darcula .ace_support.ace_type {\n  font-style: italic;\n  color: #66d9ef\n}\n\n.ace-darcula .ace_storage {\n  color: #ff79c6\n}\n\n.ace-darcula .ace_storage.ace_type {\n  font-style: italic;\n  color: #8be9fd\n}\n\n.ace-darcula .ace_invalid {\n  color: #F8F8F0;\n  background-color: #ff79c6\n}\n\n.ace-darcula .ace_invalid.ace_deprecated {\n  color: #F8F8F0;\n  background-color: #bd93f9\n}\n\n.ace-darcula .ace_string {\n  color: #f1fa8c\n}\n\n.ace-darcula .ace_comment {\n  color: #6272a4\n}\n\n.ace-darcula .ace_variable {\n  color: #50fa7b\n}\n\n.ace-darcula .ace_variable.ace_parameter {\n  font-style: italic;\n  color: #ffb86c\n}\n\n.ace-darcula .ace_entity.ace_other.ace_attribute-name {\n  color: #50fa7b\n}\n\n.ace-darcula .ace_entity.ace_name.ace_function {\n  color: #50fa7b\n}\n\n.ace-darcula .ace_entity.ace_name.ace_tag {\n  color: #ff79c6\n}\n.ace-darcula .ace_invisible {\n  color: #626680;\n}\n\n.ace-darcula .ace_indent-guide {\n  background: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAACCAYAAACZgbYnAAAAEklEQVQImWNgYGBgYHB3d/8PAAOIAdULw8qMAAAAAElFTkSuQmCC) right repeat-y\n}\n\n.ace-darcula .ace_indent-guide-active {\n  background: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAACAQMAAACjTyRkAAAABlBMVEUAAADCwsK76u2xAAAAAXRSTlMAQObYZgAAAAxJREFUCNdjYGBoAAAAhACBGFbxzQAAAABJRU5ErkJggg==") right repeat-y;\n}\n';}),ace.define("ace/theme/darcula",["require","exports","module","ace/theme/darcula-css","ace/lib/dom"],function(e,t,n){t.isDark=!0,t.cssClass="ace-darcula",t.cssText=e("./darcula-css"),t.$selectionColorConflict=!0;var r=e("../lib/dom");r.importCssString(t.cssText,t.cssClass,!1);});                (function() {
	                    ace.require(["ace/theme/darcula"], function(m) {
	                        if (module) {
	                            module.exports = m;
	                        }
	                    });
	                })();
	}(themeDarcula));

	ace$1.define("ace/ext/searchbox", function(require, exports) {

		let dom = require("../lib/dom");
		let lang = require("../lib/lang");
		let event = require("../lib/event");
		let HashHandler = require("../keyboard/hash_handler").HashHandler;
		let keyUtil = require("../lib/keys");

		let MAX_COUNT = 999;

		let SearchBox = function(editor) {	// (editor, range, showReplaceForm)
			let div = dom.createElement("div");
			dom.buildDom(["div", {class:"ace_search right"},
				["i", {action: "hide", class: "ico delete actionHover ace_searchbtn_close"}],
				["div", {class: "ace_search_form"},
					["input", {class: "ace_search_field", placeholder: "Search for", spellcheck: "false"}],
					["span", {action: "toggleCaseSensitive", class: "ace_button", title: "CaseSensitive Search"}, "Aa"],
					["span", {action: "toggleWholeWords", class: "ace_button", title: "Whole Word Search"}, "W"],
					["span", {action: "toggleRegexpMode", class: "ace_button", title: "RegExp Search"}, ".*"],
					["span", {action: "searchInSelection", class: "ace_button", title: "Search In Selection"}, "S"],

					["span", {class: "ace_search_counter"}],

					["i", {action: "findPrev", class: "ico arrowUp prev"}, ""],
					["i", {action: "findNext", class: "ico arrowDown next"}, ""],

					["button", {action: "findAll", class: "ace_searchbtn", title: "Alt-Enter"}, "All"],
				],
				["div", {class: "ace_replace_form"},
					["input", {class: "ace_search_field", placeholder: "Replace with", spellcheck: "false"}],
					["button", {action: "replaceAndFindNext", class: "ace_searchbtn"}, "Replace"],
					["button", {action: "replaceAll", class: "ace_searchbtn"}, "Replace All"]
				]
			], div);
			this.element = div.firstChild;

			this.setSession = this.setSession.bind(this);

			this.$init();
			this.setEditor(editor);
		};

		(function() {
			this.setEditor = function(editor) {
				editor.searchBox = this;
				editor.renderer.container.parentNode.insertBefore(this.element, editor.renderer.container);
				this.editor = editor;
				editor.resize();
			};

			this.setSession = function() {
				this.searchRange = null;
				this.$syncOptions(true);
			};

			this.$initElements = function(sb) {
				this.searchBox = sb.querySelector(".ace_search_form");
				this.replaceBox = sb.querySelector(".ace_replace_form");
				this.searchOption = sb.querySelector("[action=searchInSelection]");
				this.regExpOption = sb.querySelector("[action=toggleRegexpMode]");
				this.caseSensitiveOption = sb.querySelector("[action=toggleCaseSensitive]");
				this.wholeWordOption = sb.querySelector("[action=toggleWholeWords]");
				this.searchInput = this.searchBox.querySelector(".ace_search_field");
				this.replaceInput = this.replaceBox.querySelector(".ace_search_field");
				this.searchCounter = sb.querySelector(".ace_search_counter");
				this.replaceOption = {};
			};

			this.$init = function() {
				let sb = this.element;

				this.$initElements(sb);

				let _this = this;
				event.addListener(sb, "mousedown", function(e) {
					setTimeout(function(){
						_this.activeInput.focus();
					}, 0);
					event.stopPropagation(e);
				});
				event.addListener(sb, "click", function(e) {
					let t = e.target;
					let action = t.getAttribute("action");
					if (action && _this[action])
						_this[action]();
					else if (_this.$searchBarKb.commands[action])
						_this.$searchBarKb.commands[action].exec(_this);
					event.stopPropagation(e);
				});

				event.addCommandKeyListener(sb, function(e, hashId, keyCode) {
					let keyString = keyUtil.keyCodeToString(keyCode);
					let command = _this.$searchBarKb.findKeyCommand(hashId, keyString);
					if (command && command.exec) {
						command.exec(_this);
						event.stopEvent(e);
					}
				});

				this.$onChange = lang.delayedCall(function() {
					_this.find(false, false);
				});

				event.addListener(this.searchInput, "input", function() {
					_this.$onChange.schedule(20);
				});
				event.addListener(this.searchInput, "focus", function() {
					_this.activeInput = _this.searchInput;
					_this.searchInput.value && _this.highlight();
				});
				event.addListener(this.replaceInput, "focus", function() {
					_this.activeInput = _this.replaceInput;
					_this.searchInput.value && _this.highlight();
				});
			};

			//keybinding outside of the searchbox
			this.$closeSearchBarKb = new HashHandler([{
				bindKey: "Esc",
				name: "closeSearchBar",
				exec: function(editor) {
					editor.searchBox.hide();
				}
			}]);

			//keybinding outside of the searchbox
			this.$searchBarKb = new HashHandler();
			this.$searchBarKb.bindKeys({
				"Ctrl-f|Command-f": function(sb) {
					let isReplace = sb.isReplace = !sb.isReplace;
					sb.replaceBox.style.display = isReplace ? "" : "none";
					sb.replaceOption.checked = false;
					sb.$syncOptions();
					sb.searchInput.focus();
				},
				"Ctrl-H|Command-Option-F": function(sb) {
					console.log(sb);
					if (sb.editor.getReadOnly())
						return;
					sb.replaceOption.checked = true;
					sb.$syncOptions();
					sb.replaceInput.focus();
				},
				"Ctrl-G|Command-G": function(sb) {
					sb.findNext();
				},
				"Ctrl-Shift-G|Command-Shift-G": function(sb) {
					sb.findPrev();
				},
				"esc": function(sb) {
					setTimeout(function() { sb.hide();});
				},
				"Return": function(sb) {
					if (sb.activeInput === sb.replaceInput)
						sb.replace();
					sb.findNext();
				},
				"Shift-Return": function(sb) {
					if (sb.activeInput === sb.replaceInput)
						sb.replace();
					sb.findPrev();
				},
				"Alt-Return": function(sb) {
					if (sb.activeInput === sb.replaceInput)
						sb.replaceAll();
					sb.findAll();
				},
				"Tab": function(sb) {
					(sb.activeInput === sb.replaceInput ? sb.searchInput : sb.replaceInput).focus();
				}
			});

			this.$searchBarKb.addCommand({
				name: 'replace',
				//bindKey: {win: 'Ctrl-R', mac: 'Command-Option-F'},
				exec: function(editor) {
					ace$1.require('ace/config').loadModule('ace/ext/searchbox', function(e) {
						e.Search(editor, true);
						// take care of keybinding inside searchbox
						// this is too hacky :(
						let kb = editor.searchBox.$searchBarKb;
						let command = kb.commandKeyBinding['ctrl-h'];
						if (command && command.bindKey.indexOf('Ctrl-R') === -1) {
							command.bindKey += '|Ctrl-R';
							kb.addCommand(command);
						}
					});
				}
			});

			this.$searchBarKb.addCommands([{
				name: "toggleRegexpMode",
				bindKey: {win: "Alt-R|Alt-/", mac: "Ctrl-Alt-R|Ctrl-Alt-/"},
				exec: function(sb) {
					sb.regExpOption.checked = !sb.regExpOption.checked;
					sb.$syncOptions();
				}
			}, {
				name: "toggleCaseSensitive",
				bindKey: {win: "Alt-C|Alt-I", mac: "Ctrl-Alt-R|Ctrl-Alt-I"},
				exec: function(sb) {
					sb.caseSensitiveOption.checked = !sb.caseSensitiveOption.checked;
					sb.$syncOptions();
				}
			}, {
				name: "toggleWholeWords",
				bindKey: {win: "Alt-B|Alt-W", mac: "Ctrl-Alt-B|Ctrl-Alt-W"},
				exec: function(sb) {
					sb.wholeWordOption.checked = !sb.wholeWordOption.checked;
					sb.$syncOptions();
				}
			}, {
				name: "toggleReplace",
				exec: function(sb) {
					sb.replaceOption.checked = !sb.replaceOption.checked;
					sb.$syncOptions();
				}
			}, {
				name: "searchInSelection",
				exec: function(sb) {
					sb.searchOption.checked = !sb.searchRange;
					sb.setSearchRange(sb.searchOption.checked && sb.editor.getSelectionRange());
					sb.$syncOptions();
				}
			}]);

			this.setSearchRange = function(range) {
				this.searchRange = range;
				if (range) {
					this.searchRangeMarker = this.editor.session.addMarker(range, "ace_active-line");
				} else if (this.searchRangeMarker) {
					this.editor.session.removeMarker(this.searchRangeMarker);
					this.searchRangeMarker = null;
				}
			};

			this.$syncOptions = function(preventScroll) {
				dom.setCssClass(this.searchOption, "checked", this.searchOption.checked);
				dom.setCssClass(this.regExpOption, "checked", this.regExpOption.checked);
				dom.setCssClass(this.wholeWordOption, "checked", this.wholeWordOption.checked);
				dom.setCssClass(this.caseSensitiveOption, "checked", this.caseSensitiveOption.checked);
				let readOnly = this.editor.getReadOnly();
				this.replaceBox.style.display = this.replaceOption.checked && !readOnly ? "" : "none";
				this.find(false, false, preventScroll);
			};

			this.highlight = function(re) {
				this.editor.session.highlight(re || this.editor.$search.$options.re);
				this.editor.renderer.updateBackMarkers();
			};
			this.find = function(skipCurrent, backwards, preventScroll) {
				let range = this.editor.find(this.searchInput.value, {
					skipCurrent: skipCurrent,
					backwards: backwards,
					wrap: true,
					regExp: this.regExpOption.checked,
					caseSensitive: this.caseSensitiveOption.checked,
					wholeWord: this.wholeWordOption.checked,
					preventScroll: preventScroll,
					range: this.searchRange
				});
				let noMatch = !range && this.searchInput.value;
				dom.setCssClass(this.searchBox, "ace_nomatch", noMatch);
				this.editor._emit("findSearchBox", { match: !noMatch });
				this.highlight();
				this.updateCounter();
			};
			this.updateCounter = function() {
				let editor = this.editor;
				let regex = editor.$search.$options.re;
				let all = 0;
				let before = 0;
				if (regex) {
					let value = this.searchRange
						? editor.session.getTextRange(this.searchRange)
						: editor.getValue();

					let offset = editor.session.doc.positionToIndex(editor.selection.anchor);
					if (this.searchRange)
						offset -= editor.session.doc.positionToIndex(this.searchRange.start);

					let last = regex.lastIndex = 0;
					let m;
					while ((m = regex.exec(value))) {
						all++;
						last = m.index;
						if (last <= offset)
							before++;
						if (all > MAX_COUNT)
							break;
						if (!m[0]) {
							regex.lastIndex = last += 1;
							if (last >= value.length)
								break;
						}
					}
				}
				this.searchCounter.textContent = before + " of " + (all > MAX_COUNT ? MAX_COUNT + "+" : all);
				if (all === 0) {
					this.searchBox.classList.add("empty");
					this.replaceBox.classList.add("empty");
				} else {
					this.searchBox.classList.remove("empty");
					this.replaceBox.classList.remove("empty");
				}
			};
			this.findNext = function() {
				this.find(true, false);
			};
			this.findPrev = function() {
				this.find(true, true);
			};
			this.findAll = function(){
				let range = this.editor.findAll(this.searchInput.value, {
					regExp: this.regExpOption.checked,
					caseSensitive: this.caseSensitiveOption.checked,
					wholeWord: this.wholeWordOption.checked
				});
				let noMatch = !range && this.searchInput.value;
				dom.setCssClass(this.searchBox, "ace_nomatch", noMatch);
				this.editor._emit("findSearchBox", { match: !noMatch });
				this.highlight();
				this.hide();
			};
			this.replace = function() {
				if (!this.editor.getReadOnly())
					this.editor.replace(this.replaceInput.value);
			};
			this.replaceAndFindNext = function() {
				if (!this.editor.getReadOnly()) {
					this.editor.replace(this.replaceInput.value);
					this.findNext();
				}
			};
			this.replaceAll = function() {
				if (!this.editor.getReadOnly())
					this.editor.replaceAll(this.replaceInput.value);
			};

			this.hide = function() {
				this.active = false;
				this.setSearchRange(null);
				this.editor.off("changeSession", this.setSession);

				this.element.style.display = "none";
				this.editor.keyBinding.removeKeyboardHandler(this.$closeSearchBarKb);
				this.editor.focus();
			};
			this.show = function(value, isReplace) {
				this.active = true;
				this.editor.on("changeSession", this.setSession);
				this.element.style.display = "";
				this.replaceOption.checked = isReplace;

				if (value)
					this.searchInput.value = value;

				this.searchInput.focus();
				this.searchInput.select();

				this.editor.keyBinding.addKeyboardHandler(this.$closeSearchBarKb);

				this.$syncOptions(true);
			};

			this.isFocused = function() {
				let el = document.activeElement;
				return el === this.searchInput || el === this.replaceInput;
			};
		}).call(SearchBox.prototype);

		exports.SearchBox = SearchBox;

		exports.Search = function(editor, isReplace) {
			let sb = editor.searchBox || new SearchBox(editor);
			sb.show(editor.session.getTextRange(), isReplace);
		};

	});


	(function () {
		ace$1.require(["ace/ext/searchbox"], function (m) {
			if (typeof module == "object" && typeof exports == "object" && module) {
				module.exports = m;
			}
		});
	})();

	const rules$3 = [{"selector":".ace_search ","rule":"background-color: var(--body-bg-color);color: var(--text-color);overflow: hidden;margin: 0;padding: 0 0 4px 4px;white-space: normal;"},{"selector":".ace_search_form, .ace_replace_form ","rule":"margin-top: 4px;overflow: hidden;"},{"selector":".ace_search_form.ace_nomatch > .ace_search_counter ","rule":"color: red;"},{"selector":".ace_search_form.empty > i, .ace_search_form.empty > .ace_searchbtn, .ace_replace_form.empty > .ace_searchbtn ","rule":"opacity: 0.5;"},{"selector":".ace_search_form .ace_searchbtn ","rule":"width: 43px;"},{"selector":".ace_search_form > * ","rule":"vertical-align: middle;"},{"selector":".ace_search_field ","rule":"background: var(--input-bg-color);color: var(--element-text-color);border: var(--input-border);border-radius: var(--element-border-radius);-webkit-box-sizing: border-box;-moz-box-sizing: border-box;box-sizing: border-box;height: 22px;outline: 0;padding: 0 7px;margin: 0;"},{"selector":".ace_search_form .ace_search_field ","rule":"border-top-right-radius: 0;border-bottom-right-radius: 0;width: 250px;"},{"selector":".ace_search_form > i ","rule":"margin-right: 10px;"},{"selector":".ace_searchbtn, .ace_replacebtn ","rule":"margin-right: 5px;"},{"selector":".ace_replace_form .ace_search_field ","rule":"width: 338px;margin-right: 10px;"},{"selector":".ace_replace_form .ace_searchbtn ","rule":"width: 80px;"},{"selector":".ace_button ","rule":"background: var(--input-bg-color);color: var(--element-text-color);border: var(--input-border);display: inline-block;cursor: pointer;user-select: none;overflow: hidden;box-sizing: border-box;vertical-align: middle;height: 22px;width: 22px;text-align: center;line-height: 20px;"},{"selector":".ace_button ","rule":"border-left: 0;"},{"selector":".ace_button:hover ","rule":"opacity: 1;"},{"selector":".ace_button.checked ","rule":"color: var(--active-text-color);opacity: 1;"},{"selector":".ace_search_counter ","rule":"width: 80px;display: inline-block;text-align: center;"},{"selector":".ace_searchbtn_close ","rule":"cursor: pointer;display: block;float: right;margin: 6px 6px 0 0;"}];
				let cssStyle$3;
				const css$3 = {
					install:() => {
						cssStyle$3 = document.createElement("style");
						document.head.appendChild(cssStyle$3);
						const cssStyleSheet = cssStyle$3.sheet;
						rules$3.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/ui/aceEditor/ace/ext-searchbox.css]:', rules);
					},
					remove:() => {
						if (cssStyle$3) {document.head.removeChild(cssStyle$3);}
					}
				};

	const editorService = new (class {
		editor;

		constructor() {
		}

		activeSet($editor) {
			this.editor = $editor.editor;
		}
	})();

	css$4.install();
	css$3.install();

	class AceEditor extends HTMLElement {
		editor;
		#$container;

		constructor(value) {
			super();
			this.#$container = document.createElement('div');
			this.#$container.style['flex'] = '1';
			this.appendChild(this.#$container);
			this.editor = ace$1.edit(this.#$container);
			this.setMode('ace/mode/javascript');

			this.editor.setOptions({
				tabSize: 4,
				useSoftTabs: false
			});

			//set theme
			this.themeSet(settings$1.model.data.appearance.general.theme);
			Command.on('editor.setTheme', (value) => {
				this.themeSet(value);
			});

			//show Gutter
			this.editor.renderer.setShowGutter(settings$1.model.data.appearance.uiOptions.showGutter);
			Command.on('editor.showGutter', (value) => {
				this.editor.renderer.setShowGutter(value);
			});

			//show Line numbers
			this.editor.setOptions({showLineNumbers: settings$1.model.data.appearance.uiOptions.showLineNumbers});
			Command.on('editor.showLineNumbers', (value) => {
				this.editor.setOptions({showLineNumbers: value});
			});

			//show Indent
			this.editor.setOptions({displayIndentGuides: settings$1.model.data.appearance.uiOptions.showIndent});
			Command.on('editor.showIndent', (value) => {
				this.editor.setOptions({displayIndentGuides: value});
			});

			//set fontSize
			this.editor.setOptions({fontSize: settings$1.model.data.appearance.general.fontSize + "px"});
			this.addEventListener('mousewheel', (e) => {
				if (e.ctrlKey) {
					let fontSize = settings$1.model.data.appearance.general.fontSize + (e.deltaY > 0 ? -1: 1);
					if (fontSize < 10) {
						fontSize = 10;
					}
					if (fontSize > 30) {
						fontSize = 30;
					}
					Command.exec('editor.fontSize', fontSize);
					e.preventDefault();
				}
			}, true);
			Command.on('editor.fontSize', value => {
				this.editor.setOptions({fontSize: value + "px"});
			});


			if (value) {
				this.editor.setValue(value, -1);
				this.editor.getSession().setUndoManager(new ace$1.UndoManager());
			}

			(() => {
				const onChange = (e) => {
					if (e.action === 'insert' || e.action === 'remove') {
						let newValue = this.editor.getValue();
						//console.log('%c[Ace] change', 'background:red;', 'value:', this.editor.getValue(), e);
						this.dispatchEvent(
							new CustomEvent('change',
								{
									detail: {
										value: newValue
									}
								}
							)
						);
					}
				};

				let throttle;
				this.editor.on('change', (e) => {
					if (throttle) {
						clearTimeout(throttle);
						throttle = undefined;
					}
					throttle = setTimeout(() => {
						onChange(e);
					}, 20);
				});
			})();

			this.editor.selection.on('changeCursor', (e) => {
				const pos = this.editor.getCursorPosition();
				this.dispatchEvent(
					new CustomEvent('changeCursor',
						{
							detail: {
								line: pos.row + 1,
								col: pos.column
							}
						}
					)
				);
			});
		}

		themeSet(themeName) {
			console.log('editor set theme:', themeName);
			this.editor.setTheme('ace/theme/' + themeName);
		}

		connectedCallback() {
			let attrObserver = new ResizeObserver(() => {
				this.editor.resize();
			});
			attrObserver.observe(this);

			if (this.hasAttribute('readonly')) {
				this.readOnly = true;
			}
		}

		/*
		get value() {
			return this.editor.getValue();
		}

		set value(value) {
			//console.log('%c[Ace] set', 'background:red;', 'value:', value);
			this.editor.setValue(value);
			this.editor.clearSelection();
		}
		*/

		get readOnly() {
			return false;
		}

		set readOnly(value) {
			this.editor.setReadOnly(value);
			if (value) {
				this.classList.add('readOnly');
			} else {
				this.classList.remove('readOnly');
			}
		}

		setMode(mode) {
			this.editor.getSession().setMode(mode);
		}
	}

	customElements.define('x-aceeditor', AceEditor);



	//Set commands for editor
	const cmds = ["showSettingsMenu","goToNextError","goToPreviousError","selectall","centerselection","gotoline","fold","unfold","toggleFoldWidget","toggleParentFoldWidget","foldall","foldAllComments","foldOther","unfoldall","findnext","findprevious","selectOrFindNext","selectOrFindPrevious","find","overwrite","selecttostart","gotostart","selectup","golineup","selecttoend","gotoend","selectdown","golinedown","selectwordleft","gotowordleft","selecttolinestart","gotolinestart","selectleft","gotoleft","selectwordright","gotowordright","selecttolineend","gotolineend","selectright","gotoright","selectpagedown","pagedown","gotopagedown","selectpageup","pageup","gotopageup","scrollup","scrolldown","selectlinestart","selectlineend","togglerecording","replaymacro","jumptomatching","selecttomatching","expandToMatching","passKeysToBrowser", "cut","removeline","duplicateSelection","sortlines","togglecomment","toggleBlockComment","modifyNumberUp","modifyNumberDown","replace","undo","redo","copylinesup","movelinesup","copylinesdown","movelinesdown","del","backspace","cut_or_delete","removetolinestart","removetolineend","removetolinestarthard","removetolineendhard","removewordleft","removewordright","outdent","indent","blockoutdent","blockindent","insertstring","inserttext","splitline","transposeletters","touppercase","tolowercase","autoindent","expandtoline","openlink","joinlines","invertSelection","addLineAfter","addLineBefore","openCommandPallete","modeSelect","foldToLevel"];

	cmds.forEach(commandName => {
		new Command('editor.' + commandName, () => {
			if (editorService.editor) {
				editorService.editor.commands.exec(commandName, editorService.editor);
			}
		});
	});


	new Command('editor.copy', () => {
		let text = editorService.editor.getCopyText();
		navigator.permissions.query({ name: 'clipboard-write' }).then(result => {
			if (result.state === 'denied') {
				alert("To use the clipboard you need to grant permission in the browser");
			} else {
				navigator.clipboard.writeText(text);
			}
		});
	});

	new Command('editor.paste', () => {
		navigator.permissions.query({ name: 'clipboard-read' }).then(result => {
			if (result.state === 'denied') {
				alert("To use the clipboard you need to grant permission in the browser");
			} else {
				navigator.clipboard.readText()
					.then(text => {
						editorService.editor.session.insert(editorService.editor.getCursorPosition(), text);
					});
			}
		});
	});

	const rules$2 = [{"selector":"x-ide-code ","rule":"display: block;width: 100%;height: 100%;"},{"selector":"x-ide-code > x-aceeditor ","rule":""},{"selector":"x-ide-code > x-aceeditor:has(+ x-tpl_tabcontents_code_statusbar.enabled) ","rule":"padding-bottom: 24px;margin-bottom: -24px;"},{"selector":"x-ide-code > x-tpl_tabcontents_code_statusbar:not(.enabled) ","rule":"display: none;"},{"selector":"x-ide-code > x-tpl_tabcontents_code_statusbar.enabled ","rule":"display: block;height: 24px;line-height: 22px;text-align: right;padding: 1px 20px;box-sizing: border-box;background: var(--gutter-bg-color);border-top: var(--body-border);color: var(--body-text-description-color);"},{"selector":"x-ide-code > x-tpl_tabcontents_code_statusbar .filePath ","rule":"float: left;"},{"selector":"x-ide-code > x-tpl_tabcontents_code_statusbar .position ","rule":"float: right;"},{"selector":"x-ide-code > x-tpl_tabcontents_code_statusbar .position span ","rule":"margin-left: 10px;"}];
				let cssStyle$2;
				const css$2 = {
					install:() => {
						cssStyle$2 = document.createElement("style");
						document.head.appendChild(cssStyle$2);
						const cssStyleSheet = cssStyle$2.sheet;
						rules$2.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/tabContents/code/code.css]:', rules);
					},
					remove:() => {
						if (cssStyle$2) {document.head.removeChild(cssStyle$2);}
					}
				};

	let Tpl_tabContents_code_statusBar = class extends RP {
						constructor(model, logic) {
							const tree = {"vDom":{"tree":[{"type":"tag","tagName":"div","attrs":{"class":{"value":"filePath","type":"string"}},"childNodes":[{"type":"splitNode"},{"type":"textNode","value":"","placeNum":2,"valueInRender":null,"valueOutRender":"m.filePath","modelDepends":[{"refName":"m","modelPath":"filePath","canSync":true}]},{"type":"splitNode"}]},{"type":"tag","tagName":"div","attrs":{"class":{"value":"position","type":"string"}},"childNodes":[{"type":"tag","tagName":"span","attrs":{},"childNodes":[{"type":"textNode","value":"Line: "},{"type":"splitNode"},{"type":"textNode","value":"","placeNum":3,"valueInRender":null,"valueOutRender":"m.line","modelDepends":[{"refName":"m","modelPath":"line","canSync":true}]},{"type":"splitNode"}]},{"type":"tag","tagName":"span","attrs":{},"childNodes":[{"type":"textNode","value":"Col: "},{"type":"splitNode"},{"type":"textNode","value":"","placeNum":4,"valueInRender":null,"valueOutRender":"m.col","modelDepends":[{"refName":"m","modelPath":"col","canSync":true}]},{"type":"splitNode"}]},{"type":"tag","tagName":"span","attrs":{},"childNodes":[{"type":"splitNode"},{"type":"textNode","value":"","placeNum":5,"valueInRender":null,"valueOutRender":"m.lineBreak","modelDepends":[{"refName":"m","modelPath":"lineBreak","canSync":true}]},{"type":"splitNode"}]},{"type":"tag","tagName":"span","attrs":{},"childNodes":[{"type":"splitNode"},{"type":"textNode","value":"","placeNum":6,"valueInRender":null,"valueOutRender":"m.indent","modelDepends":[{"refName":"m","modelPath":"indent","canSync":true}]},{"type":"splitNode"}]},{"type":"tag","tagName":"span","attrs":{},"childNodes":[{"type":"splitNode"},{"type":"textNode","value":"","placeNum":7,"valueInRender":null,"valueOutRender":"m.size","modelDepends":[{"refName":"m","modelPath":"size","canSync":true}]},{"type":"splitNode"}]}]}]}};
							super(tree, model, logic);
						}
					};
					customElements.define('x-tpl_tabcontents_code_statusbar', Tpl_tabContents_code_statusBar);

	css$2.install();

	/**
	 * @description Code editor
	 * @param filePath	{String}
	 */
	class IdeTabContentCode extends HTMLElement {
		#value;
		#filePath;
		#fileNode;
		#isChanged;
		#$editor;

		constructor(filePath) {
			super();
			//console.log('[IdeCodeEditor] constructor, filePath:', filePath);

			const nodeNames = filePath.split('/');
			nodeNames.shift();
			this.#fileNode = nodeNames.reduce((node, name) => {
				return node.childNodes.find(item => item.title === name);
			}, projectManager.project.model.data.struct.tree[0]);
			//console.log('fileNode:', this.#fileNode);


			this.#filePath = filePath;
			this.#value = this.#fileNode.data;
			//this.lang = project.lang;

			this.#$editor = new AceEditor(this.#value);
			this.appendChild(this.#$editor);

			this.$statusBar = new Tpl_tabContents_code_statusBar({
				filePath: filePath,
				line: 0,
				col: 0,
				lineBreak: 'CR',
				indent: 'Tab',
				size: ''
			});
			this.#fileSizeUpdate();
			this.appendChild(this.$statusBar);
			this.#$editor.addEventListener('changeCursor', e => {
				this.$statusBar.model.data.line = e.detail.line;
				this.$statusBar.model.data.col = e.detail.col;
			});

			//show statusbar
			this.#sideBarUpdate(settings$1.model.data.appearance.uiOptions.showStatusBar);
			Command.on('editor.showStatusBar', (value) => {
				this.#sideBarUpdate(value);
			});


			//console.log('[IdeCodeEditor] this.#project.originalFiles:', this.#project.originalFiles, 'project:', project, 'this.#filePath:', this.#filePath);
			/*
			this.#project.struct.files._.eventAdd('change', this.#filePath, e => {
				if (e.newValue !== this.#value && this.#value !== e.newValue) {
					this.#value = e.newValue;
					//console.log('file changed', e.newValue);
					this.#onChange();
					this.#formReflow();
				}
			});
			*/
			//console.log('this.#project.originalFiles:', this.#project.originalFiles, this.#filePath);
			//console.log('[CodeEditor] files subscribed');

			//console.log('this.#$editor:', this.#$editor);
			this.#$editor.addEventListener('change', (e) => {
				if (e.target === this.#$editor && this.#value !== e.detail.value) {
					this.#value = e.detail.value;
					this.#fileNode.data = this.#value;
					//console.log('this.#project.originalFiles:', this.#project.originalFiles, this.#filePath, 'newValue', e.detail.value);
					this.#fileSizeUpdate();
					this.#onChange();
				}
			});


			if (this.#fileNode.readOnly) {
				this.#$editor.readOnly = true;
			}

			this.#formReflow();
		}

		reflow() {
			this.#formReflow();
			editorService.activeSet(this.#$editor);
		}

		#sideBarUpdate(value) {
			if (value) {
				this.$statusBar.classList.add('enabled');
			} else {
				this.$statusBar.classList.remove('enabled');
			}
		}

		#fileSizeUpdate() {
			const size = this.#value.length;
			this.$statusBar.model.data.size = size > 1000 ? (size/1000).toFixed(1) + ' kB' : size + ' B';
		}

		#onChange() {
			if (this.#fileNode.readOnly) {
				return;
			}
			this.dispatchEvent(
				new CustomEvent('change', {
					detail: {
						isChanged: this.#isChanged
					}
				})
			);
		}

		#formReflow() {
			this.#$editor.value = this.#value;
		}

	}

	customElements.define('x-ide-code', IdeTabContentCode);

	const rules$1 = [{"selector":"x-menu ","rule":"display: block;margin: 0;padding: 0;width: 100%;white-space: nowrap;"},{"selector":"x-menu x-menu-item ","rule":"position: relative;display: inline-block;font-size: 12px;cursor: default;"},{"selector":"x-menu x-menu-item.hr ","rule":"border-top: 1px solid var(--body-hr-color);"},{"selector":"x-menu x-menu-item > div ","rule":"padding: 6px 10px 4px;"},{"selector":"x-menu x-menu-item.expanded ","rule":"background: var(--element-selected-bg-color);color: var(--element-selected-text-color);"},{"selector":"x-menu x-menu-item submenu ","rule":"display: none;"},{"selector":"x-menu x-menu-item.expanded submenu ","rule":"position: absolute;z-index: 10000;display: block;top: 24px;left: 0;width: 200px;background: var(--body-bg-color);border: var(--space-border);color: var(--body-text-color);box-shadow: rgb(0,0,0, 0.2) 5px 5px 7px;"},{"selector":"x-menu x-menu-item submenu x-menu-item ","rule":"display: block;"},{"selector":"x-menu x-menu-item submenu x-menu-item:hover ","rule":"background: var(--element-selected-bg-color);color: var(--element-selected-text-color);"},{"selector":"x-menu x-menu-item submenu x-menu-item span ","rule":"display: block;"},{"selector":".line ","rule":"display: block;height: 1px;width: 100%;background-color: #323232;"}];
				let cssStyle$1;
				const css$1 = {
					install:() => {
						cssStyle$1 = document.createElement("style");
						document.head.appendChild(cssStyle$1);
						const cssStyleSheet = cssStyle$1.sheet;
						rules$1.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/ui/menu/menu.css]:', rules);
					},
					remove:() => {
						if (cssStyle$1) {document.head.removeChild(cssStyle$1);}
					}
				};

	/**
	 * usage:
	 * 		<x-menu value:="model.menuItems"></x-menu>
	 */
	css$1.install();

	class Menu extends HTMLElement {
		#isExpanded = false;
		#nodes = [];
		#currentNodePath;

		constructor(model) {
			super();
			this.model = model;
		}

		connectedCallback() {
			document.addEventListener('click', (e) => {
				if (!isChildOf(e.target, this)) {
					this.close();
				}
			});
			//console.log('[menu]', this.model.data);
			this.#render(this.model.data['config'].value, this, '');		//TODO: fix value prop
		}

		#render(data, container, path) {
			//console.log('[menu] render data:', data, container, path);
			data.forEach(value => {
				let nodeId = this.#nodes.length;
				let nodePath = (path !== '' ? path + '/' : '') + nodeId;
				let $item = document.createElement('x-menu-item');
				let $title = document.createElement('div');
				$title.innerText = value.title;
				$item.appendChild($title);
				if (value.hr) {
					$item.classList.add('hr');
				}
				let $submenu;
				if (value.childNodes && value.childNodes.length) {
					$title.addEventListener('mouseover', this.#onOver.bind(this, nodeId, nodePath));
					$submenu = document.createElement('submenu');
					$item.appendChild($submenu);
					$title.addEventListener('mousedown', this.#onSelect.bind(this, nodeId, nodePath));
				} else {
					$item.addEventListener('mousedown', this.#onAction.bind(this, nodeId));
				}

				this.#nodes.push({
					$item: $item,
					$submenu: $submenu,
					childNodes: value.childNodes,
					childrenIsRendered: false,
					action: value.action
				});
				container.appendChild($item);
			});
		}

		#onAction(nodeId, e) {
			e.preventDefault();
			e.stopImmediatePropagation();
			this.close();
			let node = this.#nodes[nodeId];
			if (node.action) {
				node.action();
			}
		}

		close() {
			this.#isExpanded = false;
			this.#stateUpdate(null, '');
		}

		#onSelect(nodeId, nodePath) {
			this.#isExpanded = !this.#isExpanded;
			this.#stateUpdate(nodeId, nodePath);
		}

		#onOver(nodeId, nodePath) {
			if (this.#isExpanded) {
				this.#stateUpdate(nodeId, nodePath);
			}
		}

		#stateUpdate(nodeId, nodePath) {
			if (this.#currentNodePath) {
				this.#currentNodePath.split('/').forEach((oldNodeId) => {
					if (!this.#isExpanded || nodePath.indexOf(oldNodeId) === -1) {
						this.#nodes[oldNodeId].$item.classList.remove('expanded');
					}
				});
			}

			this.#currentNodePath = nodePath;
			if (nodeId !== null) {
				let node = this.#nodes[nodeId];
				if (this.#isExpanded) {
					node.$item.classList.add('expanded');
					if (!node.childrenIsRendered && node.childNodes && node.childNodes.length) {
						node.childrenIsRendered = true;
						this.#render(node.childNodes, node.$submenu, nodePath);
					}
				}
			}
		}
	}

	customElements.define('x-menu', Menu);

	let Tpl_head = class extends RP {
						constructor(model, logic) {
							const tree = {"vDom":{"tree":[{"type":"tag","tagName":"span","attrs":{"onmousedown":{"type":"event","fn":"self.select(event);"}},"childNodes":[{"type":"splitNode"},{"type":"textNode","value":"","placeNum":1,"valueInRender":null,"valueOutRender":"m.name","modelDepends":[{"refName":"m","modelPath":"name","canSync":true}]},{"type":"splitNode"}]}]}};
							super(tree, model, logic);
						}
					};
					customElements.define('x-tpl_head', Tpl_head);
				
					let Tpl_head_removeButton = class extends RP {
						constructor(model, logic) {
							const tree = {"vDom":{"tree":[{"type":"tag","tagName":"i","attrs":{"class":{"value":"ico delete white errorHover","type":"string"},"onclick":{"type":"event","fn":"self.remove(event);"}},"childNodes":[]}]}};
							super(tree, model, logic);
						}
					};
					customElements.define('x-tpl_head_removebutton', Tpl_head_removeButton);

	const rules = [{"selector":"x-tab ","rule":"display: flex;flex-direction: column;height: 100%;"},{"selector":"x-tab x-tpl_head * ","rule":"cursor: default;"},{"selector":"x-tab div.tabs ","rule":"display: block;background: var(--head-background);"},{"selector":"x-tab div.tabs > * ","rule":"display: inline-block;padding: 4px 5px 0 10px;height: 25px;box-sizing: border-box;border-bottom: 3px solid var(--head-background);"},{"selector":"x-tab div.tabs > * > * ","rule":"vertical-align: middle;"},{"selector":"x-tab div.tabs > x-tpl_head:not(.selected):hover ","rule":"background: var(--element-bg-color-hover);border-bottom: 1px solid var(--active-element-bg-color);padding-bottom: 5px;"},{"selector":"x-tab div.tabs > *.selected ","rule":"background: var(--element-bg-color);border-bottom: 3px solid var(--element-selected-bg-color);"},{"selector":"x-tab div.tabs x-tpl_head_removebutton ","rule":"display: inline-block;height: 16px;margin-left: 5px;opacity: 0.3;"},{"selector":"x-tab > div.content ","rule":"display: block;flex: 1;position: relative;background: var(--space-bg-color);"},{"selector":"x-tab > div.content > * ","rule":"position: absolute;max-width: 100%;top: 0;left: 0;right: 0;bottom: 0;overflow: auto;"}];
				let cssStyle;
				const css = {
					install:() => {
						cssStyle = document.createElement("style");
						document.head.appendChild(cssStyle);
						const cssStyleSheet = cssStyle.sheet;
						rules.forEach(ruleCfg => {
							//console.log('%cselector:', 'background:green;color:white;', ruleCfg.selector);
							//console.log('rule:', ruleCfg.rule);
							cssStyleSheet.addRule(ruleCfg.selector, ruleCfg.rule, 0);
						});
						//files.push.apply(files, data.files);
						//console.log('css installed [/srv/sandox/src/components/ui/tab/tab.css]:', rules);
					},
					remove:() => {
						if (cssStyle) {document.head.removeChild(cssStyle);}
					}
				};

	css.install();

	/**
	 * @example:
	 * 		let cfg = {
	 * 		 	closeButton:	boolean				//[:false]
	 * 		 	selectOnTabCreate:	boolean			//[:false]
	 * 		}
	 * 		let $tab = new Tab(cfg);
	 * 		$tab.create(String.uid, 'tabName', $content);
	 */
	class Tab extends HTMLElement {
		#cfg;
		#tabs = {};
		#selected;
		#$heads;
		#$content;

		constructor(cfg) {
			super();
			this.#cfg = cfg || {};

			if (this.getAttribute('closeButton')) {
				this.#cfg.closeButton = true;
			}
			if (this.getAttribute('selectOnTabCreate')) {
				this.#cfg.selectOnTabCreate = true;
			}

			this.#$heads = document.createElement('div');
			this.#$heads.className = 'tabs';
			this.#$content = document.createElement('div');
			this.#$content.className = 'content';

			this.appendChild(this.#$heads);
			this.appendChild(this.#$content);
		}

		create(pid, tabName, $tabContent) {
			console.log('tab create:', pid, tabName);
			let $head = new Tpl_head({name: tabName}, {
				select: (e) => {
					if (!e.target.classList.contains('remove')) {
						this.select(pid);
					}
				}
			});

			if (this.#cfg.closeButton) {
				$head.appendChild(new Tpl_head_removeButton({}, {
					remove: (e) => {
						if (e.altKey) {
							this.closeAll(pid);
						} else {
							this.close(pid);
						}
					}
				}));
			}
			$head.pid = pid;
			this.#$heads.appendChild($head);
			this.#tabs[pid] = {name: tabName, $head: $head, $content: $tabContent};
			if (this.#cfg.selectOnTabCreate || Object.keys(this.#tabs).length === 1) {
				this.select(pid);
			}
			return pid;
		}

		select(pid) {
			//console.log('[Tab] select:', pid, this.#$content);
			if (this.#selected) {
				let oldTab = this.#tabs[this.#selected];
				oldTab.$head.classList.remove('selected');
				//console.log('[Tab] remove content:', oldTab.$content, 'selected:', this.#selected);
				this.#$content.removeChild(oldTab.$content);
			}
			this.#selected = pid;
			let tab = this.#tabs[pid];
			tab.$head.classList.add('selected');
			this.#$content.appendChild(tab.$content);
			this.dispatchEvent(new CustomEvent('select', {
				detail: {
					pid: pid
				}
			}));
			if (tab.$content.reflow) {
				tab.$content.reflow();
			}
		}

		isOpened(pid) {
			return !!this.#tabs[pid];
		}

		colorize(pid, color) {
			let tab = this.#tabs[pid];
			tab.$head.style.color = color;
		}

		get(pid) {
			return this.#tabs[pid];
		};

		close(pid) {
			let tab = this.#tabs[pid];
			if (this.#selected === pid) {
				let $newTabHead = tab.$head.previousSibling;
				if (!$newTabHead) {
					$newTabHead = tab.$head.nextSibling;
				}
				if ($newTabHead) {
					this.select($newTabHead.pid);
				} else {
					this.#$content.removeChild(tab.$content);
					this.#selected = null;
				}
			}
			this.#$heads.removeChild(tab.$head);
			delete this.#tabs[pid];
		}

		closeAll(excludeId) {
			Object.keys(this.#tabs).forEach(tabId => {
				if (excludeId !== tabId) {
					this.close(tabId);
				}
			});
		}
	}

	customElements.define('x-tab', Tab);

	css$G.install();


	const App = class {
		constructor() {
			const menuConfig = {
				value: [
					{
						title: 'File',
						childNodes: [
							{
								title: 'Create project',
								action: () => {
									busEvent.fire("actions.project.create");
								}
							},
							{
								title: 'Open project',
								action: () => {
									alert("This functionality will be implemented in ms3");
								}
							},
							{
								title: 'Close project',
								action: () => {
									busEvent.fire("actions.project.close");
								}
							},
							{
								hr: true,
								title: 'Export project as zip',
								action: () => {
									busEvent.fire("actions.project.export");
								}
							},
							{
								hr: true,
								title: 'Settings',
								action: () => {
									busEvent.fire("actions.settings.open");
								}
							},
						]
					},
					{
						title: 'Edit',
						childNodes: [
							{
								title: 'Undo',
								action: () => {
									Command.exec("editor.undo");
								}
							},
							{
								title: 'Redo',
								action: () => {
									Command.exec("editor.redo");
								}
							},
							{
								hr: true,
								title: 'Cut',
								action: () => {
									Command.exec("editor.cut");
								}
							},
							{
								title: 'Copy',
								action: () => {
									Command.exec("editor.copy");
								}
							},
							{
								title: 'Paste',
								action: () => {
									Command.exec("editor.paste");
								}
							},
							{
								title: 'Delete',
								action: () => {
									Command.exec("editor.del");
								}
							}
						]
					},
					{
						title: 'Build',
						childNodes: [
							{
								title: 'Build project',
								action: () => {
									if (projectManager.project) {
										projectManager.project.build();
									}
								}
							}
						]
					},
					{
						title: 'Help',
						childNodes: [
							{
								title: 'Getting Started',
								action: () => {
									alert("This functionality will be implemented in future");
								}
							},
							{
								title: 'Learn IDE Features',
								action: () => {
									alert("This functionality will be implemented in future");
								}
							},
						]
					}
				]
			};
			const $wrapper = new Tpl_wrapper({menu: menuConfig});
			this.$panelSpace = $wrapper.querySelector("x-panelspace");

			const config = {
				barSize: {
					top: 200,
					left: 200,
					right: 200,
					bottom: 200
				},
				panels: {
					projectInfo: {title: 'Project', bar: 'left', isOpen: false},
					network: {title: 'Network', bar: 'left', isOpen: false},
					examples: {title: 'Examples', bar: 'left'},
					console: {title: 'Console', bar: 'bottom'},
					find: {title: 'Find', bar: 'bottom'},
				}
			};

			this.$panelSpace.init({
				barSize: config.barSize,
				panels: config.panels,
				panelContentConstructors: {
					projectInfo: IdePanelProjectInfo,
					examples: IdePanelExamples,
					network: IdePanelNetwork,
					console: IdePanelConsole,
					find: IdePanelFind,
				}
			});
			this.$panelSpace.barsShow(settings$1.model.data.appearance.toolWindows.showToolBar);
			Command.on('editor.showToolBar', (value) => {
				this.$panelSpace.barsShow(value);
			});

			this.$tabs = new Tab({closeButton: true, selectOnTabCreate: true});
			this.$panelSpace.$workspace.appendChild(this.$tabs);

			document.body.appendChild($wrapper);

			busEvent.on("events.file.open", (cfg) => {
				this.tabFileOpen(cfg);
			});

			busEvent.on("events.file.delete", (cfg) => {
				this.tabFileClose(cfg);
			});

			busEvent.on("actions.panel.open", (panelName) => {
				this.$panelSpace.panelSelect(panelName);
			});

			busEvent.on("actions.settings.open", () => {
				settings();
			});

			//console.log("this.$panelSpace:", this.$panelSpace);
		}

		/**
		 *
		 * @param cfg
		 * @param cfg.path
		 * @param cfg.node
		 * @param cfg.parentNode
		 */
		tabFileOpen(cfg) {
			//console.log('[app] fileOpen:', cfg);
			let tabPid = ':' + cfg.path;
			if (this.$tabs.isOpened(tabPid)) {
				console.log('open tab pid:', tabPid);
				this.$tabs.select(tabPid);
			} else {
				let $tabContent = new IdeTabContentCode(cfg.path);
				this.$tabs.create(tabPid, cfg.node.title, $tabContent);

				let colorize = (isChanged) => {
					this.$tabs.colorize(tabPid, isChanged ? 'var(--active-text-color)' : 'var(--text-color)');
				};
				$tabContent.addEventListener('change', (e) => {
					if (e.target === $tabContent) {
						colorize(e.detail.isChanged);
					}
				});
				//console.log('this.$tabs:', this, this.$tabs);
				colorize($tabContent.isChanged);
			}
		}

		tabFileClose(cfg) {
			let tabPid = ':' + cfg.path;
			console.log('[app] fileClose:', cfg);
			this.$tabs.close(tabPid);
		}
	};

	new App();

})();
