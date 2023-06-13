import Vue from 'vue';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import WidgetManagerConstants from '@kitware/vtk.js/Widgets/Core/WidgetManager/Constants';

import {
  DEFAULT_VIEW_TYPE,
  DEFAULT_AXIS_PRESET,
  VIEW_TYPE_VALUES,
  DEFAULT_VIEW_TYPES,
  DEFAULT_LPS_VIEW_TYPES,
  DEFAULT_VIEW_ORIENTATION,
} from 'paraview-glance/src/components/core/VtkView/constants';
import { DEFAULT_BACKGROUND } from 'paraview-glance/src/components/core/VtkView/palette';

import {
  remapIdValues,
  wrapMutationAsAction,
  getLPSDirections,
  updateViewOrientationFromBasisAndAxis,
} from 'paraview-glance/src/utils';

const { CaptureOn } = WidgetManagerConstants;

export default ({ proxyManager }) => ({
  namespaced: true,
  state: {
    viewsInitialized: false,
    viewTypeToId: {}, // viewType -> view ID
    backgroundColors: {}, // viewType -> bg
    globalBackgroundColor: DEFAULT_BACKGROUND,
    axisType: 'arrow',
    axisPreset: DEFAULT_AXIS_PRESET,
    axisVisible: true,
    annotationOpacity: 1,
    interactionStyle3D: '3D',
    // The firstPersonMovementSpeed is the magnitude of the translation
    // in between animation frames while moving
    // If null, it will be calculated and set on first use
    firstPersonMovementSpeed: null,
    maxTextureLODSize: 50000, // Units are in KiB
    viewOrder: Object.values(VIEW_TYPE_VALUES),
    visibleCount: 1,
    // a basis in column-major order (list of 3 vectors): number[3][3]
    viewOrientation: DEFAULT_VIEW_ORIENTATION,
    // for each view type, the corresponding text to display { viewType: text }
    viewTypes: DEFAULT_VIEW_TYPES,
    masterSourceId: null, // null or string
    previousConfigurationPreset: null, // null or string, can only be set to a string
  },
  mutations: {
    setGlobalBackground(state, background) {
      // if global bg color changes, then all bgs change.
      state.globalBackgroundColor = background;
      const keys = Object.keys(state.backgroundColors);
      for (let i = 0; i < keys.length; i++) {
        state.backgroundColors[keys[i]] = background;
      }
    },
    setAxisType(state, type) {
      state.axisType = type;
    },
    setAxisPreset(state, preset) {
      state.axisPreset = preset;
    },
    setAxisVisible(state, visible) {
      state.axisVisible = visible;
    },
    setAnnotationOpacity(state, opacity) {
      state.annotationOpacity = opacity;
    },
    setInteractionStyle3D(state, style) {
      state.interactionStyle3D = style;
    },
    setFirstPersonMovementSpeed(state, speed) {
      state.firstPersonMovementSpeed = speed;
    },
    setMaxTextureLODSize(state, size) {
      state.maxTextureLODSize = size;
    },
    mapViewTypeToId(state, { viewType, viewId }) {
      Vue.set(state.viewTypeToId, viewType, viewId);
    },
    setViewTypes(state, types) {
      state.viewTypes = types;
    },
    setViewOrientation(state, orientation) {
      state.viewOrientation = orientation;
    },
    setMasterSourceId(state, sourceId) {
      state.masterSourceId = sourceId;
    },
    setPreviousConfigurationPreset(state, preset) {
      state.previousConfigurationPreset = preset;
    },
    changeBackground(state, { viewType, color }) {
      state.backgroundColors[viewType] = color;
    },
    viewsInitialized(state) {
      state.viewsInitialized = true;
    },
    visibleCount(state, count) {
      state.visibleCount = count;
    },
    swapViews(state, { index, viewType }) {
      // swap target view index with viewType view
      const dstIndex = state.viewOrder.indexOf(viewType);
      const srcViewType = state.viewOrder[index];
      Vue.set(state.viewOrder, index, viewType);
      Vue.set(state.viewOrder, dstIndex, srcViewType);
    },
    rewriteProxyIds(state, { views: idMapping }) {
      state.viewTypeToId = remapIdValues(state.viewTypeToId, idMapping);
    },
  },
  actions: {
    initViews({ commit, state }) {
      if (!state.viewsInitialized) {
        // 这将更新状态（state）中的viewsInitialized属性，将其设置为true，表示视图已经初始化。
        commit('viewsInitialized');

        let defaultView = null;

        // 遍历state.viewOrder数组中的每个视图类型。
        state.viewOrder.forEach((viewType) => {
          // 使用冒号分隔符将视图类型拆分为type和name两个变量。
          const [type, name] = viewType.split(':');

          // 调用proxyManager对象的createProxy方法，创建一个名为view的代理对象。
          // 该代理对象是基于类型（type）和名称（name）参数创建的视图代理。
          const view = proxyManager.createProxy('Views', type, { name });

          // Update orientation
          // 调用updateViewOrientationFromBasisAndAxis函数，更新视图的方向（orientation）。
          // 该函数接受三个参数：视图对象（view）、状态中的视图方向（state.viewOrientation）和视图名称（name）。
          
          updateViewOrientationFromBasisAndAxis(
            view,
            state.viewOrientation,
            name
          );

          // set background to transparent
          // 将视图的背景设置为透明。
          view.setBackground(0, 0, 0, 0);

          // set actual background from global bg color
          //使用Vue.js的set方法，将state.backgroundColors对象中的键为viewType的属性设置为state.globalBackgroundColor。
          // 这将为每个视图类型设置实际的背景颜色。
          Vue.set(
            state.backgroundColors,
            viewType,
            state.globalBackgroundColor
          );

          // 将视图的预设（preset）设置为默认方向轴。
          view.setPresetToOrientationAxes('default');

          // 如果视图中不存在名为'widgetManager'的引用（reference），则执行以下代码块。
          if (!view.getReferenceByName('widgetManager')) {
            // 创建一个名为widgetManager的vtkWidgetManager实例对象。
            const widgetManager = vtkWidgetManager.newInstance();
            // 将视图的渲染器（renderer）设置为widgetManager的渲染器。
            widgetManager.setRenderer(view.getRenderer());
            // 将widgetManager的捕获模式设置为在鼠标移动时捕获。
            widgetManager.setCaptureOn(CaptureOn.MOUSE_MOVE);
            // 将widgetManager作为参数，使用view对象的set方法进行设置。第二个参数true表示强制进行设置。
            view.set({ widgetManager }, true);
          }

          // 如果当前视图类型等于默认视图类型（DEFAULT_VIEW_TYPE），则执行以下代码块。
          if (viewType === DEFAULT_VIEW_TYPE) {
            // 将当前视图（view）赋值给defaultView变量。
            defaultView = view;
          }

          // 调用commit方法提交一个名为'mapViewTypeToId'的mutation，并传递一个对象作为参数。
          // 该对象包含viewType和view.getProxyId()作为属性，用于将视图类型映射到视图ID。
          commit('mapViewTypeToId', {
            viewType,
            viewId: view.getProxyId(),
          });
        });

        if (defaultView) {
          // defaultView.activate();
          defaultView.activate();
        }
      }
    },
    swapViews({ commit }, { index, viewType }) {
      commit('swapViews', { index, viewType });
    },
    singleView({ state, commit }, index) {
      commit('swapViews', {
        index: 0,
        viewType: state.viewOrder[index],
      });
      commit('visibleCount', 1);
    },
    splitView({ state, commit }, index) {
      commit('swapViews', {
        index,
        viewType: state.viewOrder[1],
      });
      commit('visibleCount', 2);
    },
    fiveview({ commit }) {
      commit('visibleCount', 6);
    },
    quadView({ commit }) {
      commit('visibleCount', 4);
    },
    setGlobalBackground({ commit }, background) {
      commit('setGlobalBackground', background);
    },
    changeBackground({ commit }, { viewType, color }) {
      commit('changeBackground', { viewType, color });
    },
    setAxisType({ commit }, axisType) {
      proxyManager.getViews().forEach((view) => {
        view.setOrientationAxesType(axisType);
      });
      commit('setAxisType', axisType);
    },
    setAxisPreset({ commit, dispatch }, axisPreset) {
      proxyManager.getViews().forEach((view) => {
        view.setPresetToOrientationAxes(axisPreset);
      });
      commit('setAxisPreset', axisPreset);
      dispatch('configureViewOrientationAndTypes', false);
    },
    setViewOrientation({ commit, state }, { orientation, blockAnimation }) {
      commit('setViewOrientation', orientation);
      Object.entries(state.viewTypeToId).forEach(([viewType, viewId]) => {
        const view = proxyManager.getProxyById(viewId);
        const [type, name] = viewType.split(':');
        updateViewOrientationFromBasisAndAxis(
          view,
          orientation,
          name,
          !blockAnimation && type === 'View3D' ? 100 : 0
        );
      });
    },
    setViewTypes({ commit }, viewTypes) {
      commit('setViewTypes', viewTypes);
    },
    configureViewOrientationAndTypes(
      { commit, dispatch, state },
      blockAnimation
    ) {
      if (state.axisPreset === 'lps') {
        const masterSource = proxyManager.getProxyById(state.masterSourceId);
        if (masterSource?.getDataset().isA('vtkImageData')) {
          // lps mode with a master volume
          const directionMatrix = masterSource.getDataset().getDirection();
          const lpsDirections = getLPSDirections(directionMatrix);
          const axisToXYZ = ['x', 'y', 'z'];
          const viewTypes = {
            [VIEW_TYPE_VALUES.default]: '3D',
            [VIEW_TYPE_VALUES[axisToXYZ[lpsDirections.l.axis]]]: 'Sagittal',
            [VIEW_TYPE_VALUES[axisToXYZ[lpsDirections.p.axis]]]: 'Coronal',
            [VIEW_TYPE_VALUES[axisToXYZ[lpsDirections.s.axis]]]: 'Axial',
          };
          const viewOrientation = [
            lpsDirections.l.vector,
            lpsDirections.p.vector,
            lpsDirections.s.vector,
          ];
          dispatch('setViewTypes', viewTypes);
          dispatch('setViewOrientation', {
            orientation: viewOrientation,
            blockAnimation,
          });
        } else if (state.previousConfigurationPreset !== 'lps') {
          // lps mode but no master volume and previous configuration wasn't lps
          dispatch('setViewTypes', DEFAULT_LPS_VIEW_TYPES);
          dispatch('setViewOrientation', {
            orientation: DEFAULT_VIEW_ORIENTATION,
            blockAnimation,
          });
        }
      } else {
        // Not in lps mode
        dispatch('setViewTypes', DEFAULT_VIEW_TYPES);
        dispatch('setViewOrientation', {
          orientation: DEFAULT_VIEW_ORIENTATION,
          blockAnimation,
        });
      }
      commit('setPreviousConfigurationPreset', state.axisPreset);
    },
    updateMasterSourceId({ dispatch, state }, datasets) {
      const hiddenDatasets = proxyManager
        .getRepresentations()
        .filter((r) => !r.isVisible())
        .map((r) => r.getInput().getProxyId());
      const fullyVisibleDatasets = datasets.filter(
        (dataset) => !hiddenDatasets.includes(dataset)
      );

      if (!fullyVisibleDatasets.includes(state.masterSourceId)) {
        if (fullyVisibleDatasets.length === 0) {
          dispatch('setMasterSourceId', null);
        } else {
          dispatch('setMasterSourceId', fullyVisibleDatasets[0]);
        }
      }
    },
    setMasterSourceId({ commit, dispatch, state }, sourceId) {
      const blockAnimation = state.masterSourceId === null && sourceId !== null;
      commit('setMasterSourceId', sourceId);
      if (state.axisPreset === 'lps') {
        dispatch('configureViewOrientationAndTypes', blockAnimation);
      }
    },
    setAxisVisible({ commit }, visible) {
      proxyManager.getViews().forEach((view) => {
        view.setOrientationAxesVisibility(visible);
      });
      commit('setAxisVisible', visible);
    },
    setAnnotationOpacity({ commit }, opacity) {
      proxyManager.getViews().forEach((view) => {
        view.setAnnotationOpacity(opacity);
      });
      commit('setAnnotationOpacity', opacity);
    },
    setInteractionStyle3D({ commit }, style) {
      proxyManager
        .getViews()
        .filter((v) => v.getName() === 'default')
        .forEach((view) => {
          view.setPresetToInteractor3D(style);
        });
      commit('setInteractionStyle3D', style);
    },
    setFirstPersonMovementSpeed({ commit }, speed) {
      const views = proxyManager
        .getViews()
        .filter((v) => v.getName() === 'default');
      views.forEach((view) => {
        const interactorStyle = view.getInteractorStyle3D();
        const manipulators = interactorStyle.getKeyboardManipulators();
        manipulators.forEach((manipulator) => {
          if (manipulator.setMovementSpeed) {
            manipulator.setMovementSpeed(speed);
          }
        });
      });

      commit('setFirstPersonMovementSpeed', speed);
    },
    resetFirstPersonMovementSpeed({ dispatch }) {
      let speed = 0;
      const views = proxyManager
        .getViews()
        .filter((v) => v.getName() === 'default');
      for (let i = 0; i < views.length; ++i) {
        const view = views[i];
        const interactorStyle = view.getInteractorStyle3D();
        const manipulators = interactorStyle.getKeyboardManipulators();
        for (let j = 0; j < manipulators.length; ++j) {
          const manipulator = manipulators[j];
          if (manipulator.resetMovementSpeed) {
            manipulator.setRenderer(view.getRenderer());
            manipulator.resetMovementSpeed();
            speed = manipulator.getMovementSpeed();
            break;
          }
        }
      }

      if (speed < 0) {
        speed = 0;
      }

      // Make sure all manipulators get updated
      dispatch('setFirstPersonMovementSpeed', speed);
    },
    setMaxTextureLODSize({ commit }, size) {
      commit('setMaxTextureLODSize', size);
    },
    rewriteProxyIds: wrapMutationAsAction('rewriteProxyIds'),
  },
});
