import JSZip from 'jszip';

import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import ReaderFactory from 'paraview-glance/src/io/ReaderFactory';
import postProcessDataset from 'paraview-glance/src/io/postProcessing';
import Vue from 'vue';

// ----------------------------------------------------------------------------

function getSupportedExtensions() {
  return ['zip', 'raw', 'glance', 'gz'].concat(
    ReaderFactory.listSupportedExtensions()
  );
}

// ----------------------------------------------------------------------------

export function getExtension(filename) {
  const i = filename.lastIndexOf('.');
  if (i > -1) {
    return filename.substr(i + 1).toLowerCase();
  }
  return '';
}

// ----------------------------------------------------------------------------

function zipGetSupportedFiles(zip, path) {
  const supportedExts = getSupportedExtensions();
  const promises = [];
  zip.folder(path).forEach((relPath, file) => {
    if (file.dir) {
      promises.push(zipGetSupportedFiles(zip, relPath));
    } else if (supportedExts.indexOf(getExtension(file.name)) > -1) {
      const splitPath = file.name.split('/');
      const baseName = splitPath[splitPath.length - 1];
      promises.push(
        zip
          .file(file.name)
          .async('blob')
          .then((blob) => new File([blob], baseName))
      );
    }
  });
  return promises;
}

// ----------------------------------------------------------------------------

function readRawFile(file, { dimensions, spacing, dataType }) {
  return new Promise((resolve, reject) => {
    const fio = new FileReader();
    fio.onload = function onFileReaderLoad() {
      const dataset = vtkImageData.newInstance({
        spacing,
        extent: [
          0,
          dimensions[0] - 1,
          0,
          dimensions[1] - 1,
          0,
          dimensions[2] - 1,
        ],
      });
      const scalars = vtkDataArray.newInstance({
        name: 'Scalars',
        values: new dataType.constructor(fio.result),
      });
      dataset.getPointData().setScalars(scalars);

      resolve(dataset);
    };

    fio.onerror = (error) => reject(error);

    fio.readAsArrayBuffer(file);
  });
}

// ----------------------------------------------------------------------------

export default ({ proxyManager, girder }) => ({
  namespaced: true,
  state: {
    remoteFileList: [],
    fileList: [],
    loading: false,
    progress: {},
  },

  getters: {
    anyErrors(state) {
      return state.fileList.reduce(
        (flag, file) => flag || file.state === 'error',
        false
      );
    },

    totalProgress(state) {
      const itemProgresses = Object.values(state.progress);
      if (itemProgresses.length === 0) {
        return 0;
      }
      return (
        itemProgresses.reduce((sum, val) => sum + val, 0) /
        itemProgresses.length
      );
    },
  },

  mutations: {
    startLoading(state) {
      state.loading = true;
    },

    stopLoading(state) {
      state.loading = false;
    },

    resetQueue(state) {
      state.fileList = [];
    },

    addToFileList(state, files) {
      debugger
      for (let i = 0; i < files.length; i++) {
        const fileInfo = files[i];

        const fileState = {
          // possible values: needsDownload, needsInfo, loading, ready, error
          state: 'loading',
          name: fileInfo.name,
          ext: getExtension(fileInfo.name),
          files: null,
          reader: null,
          extraInfo: null,
          remoteURL: null,
          withGirderToken: false,
          proxyKeys: fileInfo.proxyKeys,
        };

        if (fileInfo.type === 'dicom') {
          fileState.files = fileInfo.list;
        }
        if (fileInfo.type === 'remote') {
          Object.assign(fileState, {
            state: 'needsDownload',
            remoteURL: fileInfo.remoteURL,
            remoteOpts: fileInfo.remoteOpts || {},
            withGirderToken: !!fileInfo.withGirderToken,
          });
        }
        if (fileInfo.type === 'regular') {
          fileState.files = [fileInfo.file];
        }

        state.fileList.push(fileState);
      }
    },

    setFileNeedsInfo(state, index) {
      if (index >= 0 && index < state.fileList.length) {
        state.fileList[index].state = 'needsInfo';
        state.fileList[index].extraInfo = null;
      }
    },

    setRemoteFile(state, { index, file }) {
      if (index >= 0 && index < state.fileList.length) {
        state.fileList[index].state = 'loading';
        state.fileList[index].files = [file];
      }
    },

    setFileReader(state, { index, reader }) {
      if (reader && index >= 0 && index < state.fileList.length) {
        state.fileList[index].reader = reader;
        state.fileList[index].state = 'ready';
      }
    },

    setRawFileInfo(state, { index, info }) {
      if (info && index >= 0 && index < state.fileList.length) {
        state.fileList[index].extraInfo = info;
        state.fileList[index].state = 'loading';
      }
    },

    setFileError(state, { index, error }) {
      if (error && index >= 0 && index < state.fileList.length) {
        state.fileList[index].error = error;
        state.fileList[index].state = 'error';
      }
    },

    deleteFile(state, index) {
      if (index >= 0 && index < state.fileList.length) {
        state.fileList.splice(index, 1);
      }
    },

    setProgress(state, { id, percentage }) {
      Vue.set(state.progress, id, percentage);
    },

    clearProgresses(state) {
      state.progress = {};
    },
  },

  actions: {
    promptLocal({ dispatch }) {
      const exts = getSupportedExtensions();
      return new Promise((resolve, reject) =>
        ReaderFactory.openFiles(exts, (files) => {
          dispatch('openFiles', Array.from(files)).then(resolve).catch(reject);
        })
      );
    },

    resetQueue({ commit }) {
      this.deleteFile
      commit('resetQueue');
    },

    deleteFile({ commit }, index) {
      commit('deleteFile', index);
    },

    openRemoteFiles({ commit, dispatch }, remoteFiles) {
      commit(
        'addToFileList',
        remoteFiles.map((rfile) => ({
          type: 'remote',
          name: rfile.name,
          remoteURL: rfile.url,
          remoteOpts: rfile.options,
          withGirderToken: !!rfile.withGirderToken,
          // Key value pairs to be eventually set on the proxy
          proxyKeys: rfile.proxyKeys,
        }))
      );

      return dispatch('readAllFiles');
    },

    openFiles({ commit, dispatch }, files) {
      const zips = files.filter((f) => getExtension(f.name) === 'zip');
      if (zips.length) {
        const nonzips = files.filter((f) => getExtension(f.name) !== 'zip');
        const p = zips.map((file) =>
          JSZip.loadAsync(file).then((zip) =>
            Promise.all(zipGetSupportedFiles(zip))
          )
        );
        return Promise.all(p)
          .then((results) => [].concat.apply(nonzips, results))
          .then((newFileList) => dispatch('openFiles', newFileList));
      }

      // split out dicom and single datasets
      // all dicom files are assumed to be from a single series
      const regularFileList = [];
      const dicomFileList = [];
      files.forEach((f) => {
        if (getExtension(f.name) === 'dcm') {
          dicomFileList.push(f);
        } else {
          regularFileList.push(f);
        }
      });

      if (dicomFileList.length) {
        const dicomFile = {
          type: 'dicom',
          name: dicomFileList[0].name, // pick first file for name
          list: dicomFileList,
        };
        commit('addToFileList', [dicomFile]);
      }
      debugger
      commit(
        'addToFileList',
        regularFileList.map((f) => ({
          type: 'regular',
          name: f.name,
          file: f,
        }))
      );

      return dispatch('readAllFiles');
    },

    readAllFiles({ dispatch, state }) {
      const readPromises = [];
      for (let i = 0; i < state.fileList.length; i++) {
        readPromises.push(dispatch('readFileIndex', i));
      }

      return Promise.all(readPromises);
    },

    readFileIndex({ commit, dispatch, state }, fileIndex) {
      const file = state.fileList[fileIndex];
      let ret = Promise.resolve();

      if (file.state === 'ready' || file.state === 'error') {
        return ret;
      }

      if (file.state === 'needsDownload' && file.remoteURL) {
        if (file.withGirderToken) {
          file.remoteOpts.headers = {
            ...file.remoteOpts.headers,
            'Girder-Token': girder.girderRest.token,
          };
        }
        ret = ReaderFactory.downloadDataset(file.name, file.remoteURL, {
          ...file.remoteOpts,
          progressCallback(progress) {
            const percentage = progress.lengthComputable
              ? progress.loaded / progress.total
              : Infinity;
            commit('setProgress', { id: file.name, percentage });
          },
        })
          .then((datasetFile) => {
            commit('setRemoteFile', {
              index: fileIndex,
              file: datasetFile,
            });
            // re-run ReadFileIndex on our newly downloaded file.
            return dispatch('readFileIndex', fileIndex);
          })
          .catch(() => {
            throw new Error('Failed to download file');
          });
      } else if (file.ext === 'raw') {
        if (file.extraInfo) {
          ret = readRawFile(file.files[0], file.extraInfo).then((ds) => {
            commit('setFileReader', {
              index: fileIndex,
              reader: {
                name: file.name,
                dataset: ds,
              },
            });
          });
        }
        commit('setFileNeedsInfo', fileIndex);
      } else if (file.ext === 'dcm') {
        ret = ReaderFactory.loadFileSeries(file.files, 'dcm', file.name).then(
          (r) => {
            if (r) {
              commit('setFileReader', {
                index: fileIndex,
                reader: r,
              });
            }
          }
        );
      } else {
        if (file.ext === 'glance') {
          // see if there is a state file before this one
          for (let i = 0; i < fileIndex; i++) {
            const f = state.fileList[i];
            if (f.ext === 'glance') {
              const error = new Error('Cannot load multiple state files');
              commit('setFileError', {
                index: fileIndex,
                error,
              });
              return ret;
            }
          }
        }

        ret = ReaderFactory.loadFiles(file.files).then((r) => {
          if (r && r.length === 1) {
            commit('setFileReader', {
              index: fileIndex,
              reader: r[0],
            });
          }
        });
      }

      return ret.catch((error) => {
        if (error) {
          commit('setFileError', {
            index: fileIndex,
            error: error.message || 'File load failure',
          });
        }
      });
    },

    setRawFileInfo({ commit, dispatch }, { index, info }) {
      if (info) {
        commit('setRawFileInfo', { index, info });
      } else {
        commit('setFileNeedsInfo', index);
      }
      return dispatch('readFileIndex', index);
    },

    load({ state, commit, dispatch }) {
      // 首先，通过调用 commit 方法触发 startLoading 和 clearProgresses mutations，用于更新状态以表示加载过程的开始。
      commit('startLoading');
      commit('clearProgresses');

      // 接下来，从 Vuex store 的 state 中获取处于 "ready" 状态的文件列表，并存储在 readyFiles 中。
      const readyFiles = state.fileList.filter((f) => f.state === 'ready');

      // 声明一个 promise 变量并初始化为一个已解决（resolved）的 Promise。
      let promise = Promise.resolve();

      // load state file first
      // 检查是否存在名为 "glance" 的文件，如果存在，则加载该文件。具体做法是找到对应的文件读取器（reader），
      // 将其解析为 ArrayBuffer，然后调用名为 restoreAppState 的 action，
      // 并传递解析后的应用程序状态数据（通过调用 reader.getAppState()）作为参数。此 action 将在根模块中调用。
      const stateFile = readyFiles.find((f) => f.ext === 'glance');
      if (stateFile) {
        const reader = stateFile.reader.reader;
        promise = promise.then(() =>
          reader.parseAsArrayBuffer().then(() =>
            dispatch('restoreAppState', reader.getAppState(), {
              root: true,
            })
          )
        );
      }

      // 将不是 "glance" 文件的其他文件从 readyFiles 中筛选出来，并分别存储在 regularFiles、labelmapFiles 和 measurementFiles 数组中。
      // 遍历 otherFiles 数组，根据文件的元数据（proxyKeys.meta）判断文件的类型，并将其分别放入相应的数组中。
      promise = promise.then(() => {
        debugger
        const otherFiles = readyFiles.filter((f) => f.ext !== 'glance');
        const regularFiles = [];
        const labelmapFiles = [];
        const measurementFiles = [];
        for (let i = 0; i < otherFiles.length; i++) {
          const file = otherFiles[i];
          const meta = (file.proxyKeys && file.proxyKeys.meta) || {};
          if (meta.glanceDataType === 'vtkLabelMap') {
            
            labelmapFiles.push(file);
          } else if (file.name.endsWith('.measurements.json')) {
            measurementFiles.push(file);
          } else {
            regularFiles.push(file);
          }
        }
        // 定义了一个名为 loadFiles 的函数，该函数接受一个文件列表作为参数，并返回一个包含加载的数据源的数组。
        // 调用 loadFiles 函数来加载 regularFiles 和 labelmapFiles 中的文件，并将加载的数据源存储在 sources 变量中。
        // 使用 proxyManager.getSources() 方法获取当前已加载的数据源，并筛选出数据源名称为 "TrivialProducer" 的数据源，将结果存储在 sources 变量中。
        const loadFiles = (fileList) => {
          let ret = [];
          for (let i = 0; i < fileList.length; i++) {
            const f = fileList[i];
            const readerBundle = {
              ...f.reader,
              metadata: f.reader.metadata || {},
            };

            if (f.remoteURL) {
              Object.assign(readerBundle.metadata, { url: f.remoteURL });
            }

            const meta = f.proxyKeys && f.proxyKeys.meta;
            if (meta) {
              const { reader, dataset } = readerBundle;
              const ds =
                reader && reader.getOutputData
                  ? reader.getOutputData()
                  : dataset;
              Object.assign(readerBundle, {
                // use dataset instead of reader
                dataset: postProcessDataset(ds, meta),
                reader: null,
              });
            }
           
            const sources = ReaderFactory.registerReadersToProxyManager(
              [{ ...readerBundle, proxyKeys: f.proxyKeys }],
              proxyManager
            );
            ret = ret.concat(sources.filter(Boolean));
          }
          return ret;
        };

        loadFiles(regularFiles);
        const loadedLabelmaps = loadFiles(labelmapFiles);

        const sources = proxyManager
          .getSources()
          .filter((p) => p.getProxyName() === 'TrivialProducer');



        // attach labelmaps to most recently loaded image
        // 首先，检查 sources 数组的最后一个元素（即最近加载的数据源），如果存在，则获取其代理ID（getProxyId() 方法），并存储在 lastSourcePID 变量中。
        // 遍历 loadedLabelmaps 数组，为每个加载的标签地图（labelmap）调用 widgets/addLabelmapToImage action，并传递最近加载的数据源ID和标签地图的代理ID作为参数。然后，为每个标签地图调用 widgets/setLabelmapState action，设置其初始状态。
        // 遍历 measurementFiles 数组，为每个测量文件调用 widgets/addMeasurementTool action，并传递最近加载的数据源ID、组件名称和测量数据作为参数。
        if (sources[sources.length - 1]) {
          const lastSourcePID = sources[sources.length - 1].getProxyId();
          for (let i = 0; i < loadedLabelmaps.length; i++) {
            const lmProxy = loadedLabelmaps[i];
            dispatch(
              'widgets/addLabelmapToImage',
              {
                imageId: lastSourcePID,
                labelmapId: lmProxy.getProxyId(),
              },
              { root: true }
            ).then(() =>
              dispatch(
                'widgets/setLabelmapState',
                {
                  labelmapId: lmProxy.getProxyId(),
                  labelmapState: {
                    selectedLabel: 1,
                    lastColorIndex: 1,
                  },
                },
                { root: true }
              )
            );
          }

          // attach measurements to most recently loaded image
          for (let i = 0; i < measurementFiles.length; i++) {
            const measurements =
              measurementFiles[i].reader.reader.getOutputData();
            for (let m = 0; m < measurements.length; m++) {
              dispatch(
                'widgets/addMeasurementTool',
                {
                  datasetId: lastSourcePID,
                  componentName: measurements[m].componentName,
                  data: measurements[m].data,
                },
                { root: true }
              );
            }
          }
        }
      });

      return promise.finally(() => commit('stopLoading'));
    },
  },
});
