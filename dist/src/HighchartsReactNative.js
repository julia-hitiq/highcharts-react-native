import React from 'react';
import { View, Dimensions, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { Asset, FileSystem } from 'react-native-unimodules';
import HighchartsModules from './HighchartsModules';

const win = Dimensions.get('window');
const path = FileSystem.documentDirectory + 'dist/highcharts-files/highcharts.js';
const stringifiedScripts = {};

let cdnPath = 'code.highcharts.com/';
let httpProto = 'http://';

export default class HighchartsReactNative extends React.PureComponent {
	static getDerivedStateFromProps(props, state) {
		let width = Dimensions.get('window').width;
		let height = Dimensions.get('window').height;
		if (!!props.styles) {
			const userStyles = StyleSheet.flatten(props.styles);
			const { width: w, height: h } = userStyles;
			width = w;
			height = h;
		}
		return {
			width: width,
			height: height
		};
	}

	getHcAssets = async (useCDN) => {
		await this.setLayout();
		await this.getScript('highcharts', null, useCDN);
		await this.getScript('highcharts-more', null, useCDN);
		await this.getScript('highcharts-3d', null, useCDN);
		for (const mod of this.state.modules) {
			await this.getScript(mod, true, useCDN);
		}
		this.setState({
			hcModulesReady: true
		});
	};

	getScript = async (name, isModule, useCDN) => {
		let inline;

		if (useCDN) {
			const response = await fetch(httpProto + cdnPath + (isModule ? 'modules/' : '') + name + '.js');
			inline = await response.text();
		} else {
			const script = Asset.fromModule(isModule && name !== 'highcharts-more' && name !== 'highcharts-3d' ? HighchartsModules.modules[name] : HighchartsModules[name]);

			await script.downloadAsync();
			inline = await FileSystem.readAsStringAsync(script.localUri);
		}

		stringifiedScripts[name] = inline;
	};

	setLayout = async () => {
		const indexHtml = Asset.fromModule(require('../highcharts-layout/index.html'));
		await indexHtml.downloadAsync();
		const htmlString = await FileSystem.readAsStringAsync(indexHtml.localUri);
		this.setState({
			layoutHTML: htmlString
		});
	};

	constructor(props) {
		super(props);

		if (props.useSSL) {
			httpProto = 'https://';
		}

		if (typeof props.useCDN === 'string') {
			cdnPath = props.useCDN;
		}

		// extract width and height from user styles
		const userStyles = StyleSheet.flatten(props.styles);

		this.state = {
			width: userStyles.width || win.width,
			height: userStyles.height || win.height,
			chartOptions: props.options,
			useCDN: props.useCDN || false,
			modules: props.modules || [],
			setOptions: props.setOptions || {},
			renderedOnce: false,
			hcModulesReady: false
		};
		this.webviewRef = null;

		this.getHcAssets(this.state.useCDN);
	}
	componentDidUpdate() {
		this.webviewRef && this.webviewRef.postMessage(this.serialize(this.props.options, true));
	}
	componentDidMount() {
		this.setState({ renderedOnce: true });
	}
	/**
     * Convert JSON to string. When is updated, functions (like events.load) 
     * is not wrapped in quotes.
     */
	serialize(chartOptions, isUpdate) {
		var hcFunctions = {},
			serializedOptions,
			i = 0;

		serializedOptions = JSON.stringify(chartOptions, function(val, key){
			var fcId = '###HighchartsFunction' + i + '###';

			// set reference to function for the later replacement
			if (typeof key === 'function') {
				hcFunctions[fcId] = key.toString();
				i++;
				return isUpdate ? key.toString() : fcId;
			}

			return key;
		});

		// replace ids with functions.
		if (!isUpdate) {
			Object.keys(hcFunctions).forEach(function(key){
				serializedOptions = serializedOptions.replace('"' + key + '"', hcFunctions[key]);
			});
		}

		return serializedOptions;
	}
	render() {
		if (this.state.hcModulesReady) {
			const scriptsPath = this.state.useCDN ? httpProto.concat(cdnPath) : path;
			const setOptions = this.state.setOptions;
			const runFirst = `
                window.data = \"${this.props.data ? this.props.data : null}\";
                var modulesList = ${JSON.stringify(this.state.modules)};
                var readable = ${JSON.stringify(stringifiedScripts)}

                function loadScripts(file, callback, redraw) {
                    var hcScript = document.createElement('script');
                    hcScript.innerHTML = readable[file]
                    document.body.appendChild(hcScript);

                    if (callback) {
                        callback.call();
                    }

                    if (redraw) {
                        Highcharts.setOptions('${this.serialize(setOptions)}');
                        Highcharts.chart("container", ${this.serialize(this.props.options)});
                    }
                }

                loadScripts('highcharts', function () {
                    var redraw = modulesList.length > 0 ? false : true;
                    loadScripts('moment.min', undefined, true);
				loadScripts('moment-timezone-with-data-2012-2022.min', undefined, true);
                    loadScripts('highcharts-more', function () {
                        if (modulesList.length > 0) {
                            for (var i = 0; i < modulesList.length; i++) {
                                if (i === (modulesList.length - 1)) {
                                    redraw = true;
                                } else {
                                    redraw = false;
                                }
                                loadScripts(modulesList[i], undefined, redraw, true);
                            }
                        }
                    }, redraw);
                }, false);
            `;

			// Create container for the chart
			return (
				<View style={[ this.props.styles, { width: this.state.width, height: this.state.height } ]}>
					<WebView
						ref={(ref) => {
							this.webviewRef = ref;
						}}
						onMessage={this.props.onMessage ? (event) => this.props.onMessage(event.nativeEvent.data) : () => {}}
						source={{
							html: this.state.layoutHTML
						}}
						injectedJavaScript={runFirst}
						originWhitelist={[ '*' ]}
						automaticallyAdjustContentInsets={true}
						allowFileAccess={true}
						javaScriptEnabled={true}
						domStorageEnabled={true}
						useWebKit={true}
						scrollEnabled={false}
						mixedContentMode='always'
						allowFileAccessFromFileURLs={true}
						startInLoadingState={this.props.loader}
						style={this.props.webviewStyles}
					/>
				</View>
			);
		} else {
			return <View />;
		}
	}
}
