/**
 * @author David Gossow - dgossow@willowgarage.com
 */

var Service = require('../core/Service.js');
var ServiceRequest = require('../core/ServiceRequest.js');
var Goal = require('../actionlib/Goal');
var Transform = require('../math/Transform');

/**
 * A TF Client that listens to TFs from tf2_web_republisher.
 *
 *  @constructor
 *  @param options - object with following keys:
 *   * ros - the ROSLIB.Ros connection handle
 *   * fixedFrame - the fixed frame, like /base_link
 *   * angularThres - the angular threshold for the TF republisher
 *   * transThres - the translation threshold for the TF republisher
 *   * rate - the rate for the TF republisher
 *   * goalUpdateDelay - the goal update delay for the TF republisher
 *   * topicTimeout - the timeout parameter for the TF republisher
 */
function TFClient(options) {
  options = options || {};
  this.ros = options.ros;
  this.fixedFrame = options.fixedFrame || '/base_link';
  this.angularThres = options.angularThres || 2.0;
  this.transThres = options.transThres || 0.01;
  this.rate = options.rate || 10.0;
  this.goalUpdateDelay = options.goalUpdateDelay || 50;
  var seconds = options.topicTimeout || 2.0;
  var secs = Math.floor(seconds);
  var nsecs = Math.floor((seconds - secs) * 1000000000);
  this.topicTimeout = {
    secs: secs,
    nsecs: nsecs
  };

  this.currentTopic = false;
  this.frameInfos = {};
  this.goalUpdateRequested = false;

  // Create a Service client
  this.serviceClient = this.ros.Service({
    name: '/republish_tfs',
    serviceType: 'tf2_web_republisher/RepublishTFs'
  });
}

/**
 * Process the incoming TF message and send them out using the callback
 * functions.
 *
 * @param tf - the TF message from the server
 */
TFClient.prototype.processFeedback = function(tf) {
  var that = this;
  tf.transforms.forEach(function(transform) {
    var frameID = transform.child_frame_id;
    if (frameID[0] === '/') {
      frameID = frameID.substring(1);
    }
    var info = that.frameInfos[frameID];
    if (info !== undefined) {
      info.transform = new Transform({
        translation : transform.transform.translation,
        rotation : transform.transform.rotation
      });
      info.cbs.forEach(function(cb) {
        cb(info.transform);
      });
    }
  });
};

/**
 * Create and send a new goal to the tf2_web_republisher based on the current
 * list of TFs.
 */
TFClient.prototype.updateGoal = function() {
  var request = new ServiceRequest({
    source_frames : [],
    target_frame : this.fixedFrame,
    angular_thres : this.angularThres,
    trans_thres : this.transThres,
    rate : this.rate,
    timeout: this.topicTimeout
  });

  for (var frame in this.frameInfos) {
    request.source_frames.push(frame);
  }
  this.serviceClient.callService(request, this.processResponse.bind(this));
  this.goalUpdateRequested = false;
};

/**
 * Process the service response and subscribe to the tf republisher
 * topic
 *
 * @param response the service response containing the topic name
 */
TFClient.prototype.processResponse = function(response) {
  // if we subscribed to a topic before, unsubscribe so
  // the republisher stops publishing it
  if (this.currentTopic) {
    this.currentTopic.unsubscribe();
  }

  this.currentTopic = this.ros.Topic({
    name: response.topic_name,
    messageType: 'tf2_web_republisher/TFArray'
  });
  this.currentTopic.subscribe(this.processFeedback.bind(this));
};

/**
 * Subscribe to the given TF frame.
 *
 * @param frameID - the TF frame to subscribe to
 * @param callback - function with params:
 *   * transform - the transform data
 */
TFClient.prototype.subscribe = function(frameID, callback) {
  // remove leading slash, if it's there
  if (frameID[0] === '/') {
    frameID = frameID.substring(1);
  }
  // if there is no callback registered for the given frame, create emtpy callback list
  if (this.frameInfos[frameID] === undefined) {
    this.frameInfos[frameID] = {
      cbs : []
    };
    if (!this.goalUpdateRequested) {
      setTimeout(this.updateGoal.bind(this), this.goalUpdateDelay);
      this.goalUpdateRequested = true;
    }
  } else {
    // if we already have a transform, call back immediately
    if (this.frameInfos[frameID].transform !== undefined) {
      callback(this.frameInfos[frameID].transform);
    }
  }
  this.frameInfos[frameID].cbs.push(callback);
};

/**
 * Unsubscribe from the given TF frame.
 *
 * @param frameID - the TF frame to unsubscribe from
 * @param callback - the callback function to remove
 */
TFClient.prototype.unsubscribe = function(frameID, callback) {
  // remove leading slash, if it's there
  if (frameID[0] === '/') {
    frameID = frameID.substring(1);
  }
  var info = this.frameInfos[frameID];
  if (info !== undefined) {
    var cbIndex = info.cbs.indexOf(callback);
    if (cbIndex >= 0) {
      info.cbs.splice(cbIndex, 1);
      if (info.cbs.length === 0) {
        delete this.frameInfos[frameID];
      }
      this.needUpdate = true;
    }
  }
};

module.exports = TFClient;
