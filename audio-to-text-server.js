var fs = require('fs');
// required if we are to run the server over https
var http = require('http');
var express = require('express');
// socket.io-stream for managein binary streams on client and server
var ss = require('socket.io-stream');
// authenticate through firebase and store the flac file in the default firebase bucjet to avoid the complex rest bucket post file process
var admin = require('firebase-admin');
var Speech = require('@google-cloud/speech').SpeechClient;
//console.log(Speech);
var serviceAccount = require('./key/benkyohr-e00dc-firebase-adminsdk-125v5-d1fdc86be0.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: "benkyohr-e00dc.appspot.com"
});

var app = express();

var serverPort = 9006;

var server = https.createServer(app);

//socket.io requirement and initialization
var io = require('socket.io')(server);

io.on('connection', function(socket){
  console.log('new connection');
  // socket.io-stream event listening from the app-server
  ss(socket).on('appserver-stream-request', function(stream, fileNameFLACObj){
    const filePathFLAC = `./files_for_text/${fileNameFLACObj.fileNameFLAC}`;
    // node filestream to save file on server filesystem
    console.log(filePathFLAC);
    var writeStream = fs.createWriteStream(filePathFLAC);
    stream.pipe(writeStream);
    // when flac file has completely arrived form app-server
    stream.on('end', ()=>{
      socket.emit('textserver-flac-upload-completed');
      // get a reference through the default google bucket of firebase app
      var storageRef = admin.storage().bucket();
      // upload flac file to google bucket
      storageRef.upload( filePathFLAC, { destination: fileNameFLACObj.fileNameFLAC, public: true })
      .then(function(response){
        console.log('upload completed');
        var bucketURI = `gs://benkyohr-e00dc.appspot.com/${fileNameFLACObj.fileNameFLAC}`;
        // call the function that gets back the text from the flac file on the google bucket
        asyncRecognizeGCS(bucketURI, 'FLAC', 16000, 'en-US', function(transcribedText){
          socket.emit('textserver-transcribebtext', {transcribedText}, (confirmation) =>{
            if (confirmation) {
              socket.disconnect();
            }
            console.log(confirmation);
          });
        });
      })
      .catch(function(err){
        console.log(err);
      });
    });
  });
});



server.listen(serverPort, function(){
  console.log('HTTP server up and running at %s port', serverPort);
});

//-------------------------------------------------------------------

function asyncRecognizeGCS (gcsUri, encoding, sampleRateHertz, languageCode, callback) {
  // [START speech_async_recognize_gcs]
  // Imports the Google Cloud client library
  // const Speech = require('@google-cloud/speech');

  // Instantiates a client
  const speech = new Speech();

  // The Google Cloud Storage URI of the file on which to perform speech recognition, e.g. gs://my-bucket/audio.raw
  // const gcsUri = 'gs://my-bucket/audio.raw';

  // The encoding of the audio file, e.g. 'LINEAR16'
  // const encoding = 'LINEAR16';

  // The sample rate of the audio file in hertz, e.g. 16000
  // const sampleRateHertz = 16000;

  // The BCP-47 language code to use, e.g. 'en-US'
  // const languageCode = 'en-US';

  const config = {
    encoding: encoding,
    sampleRateHertz: sampleRateHertz,
    languageCode: languageCode
  };

  const audio = {
    uri: gcsUri
  };

  const request = {
    config: config,
    audio: audio
  };

  // Detects speech in the audio file. This creates a recognition job that you
  // can wait for now, or get its result later.
  speech.longRunningRecognize(request)
    .then((data) => {
      const operation = data[0];
      // Get a Promise representation of the final result of the job
      return operation.promise();
    })
    .then((data) => {
      const response = data[0];
      const transcription = response.results.map(result =>
        result.alternatives[0].transcript).join('\n');
      // here the promise for transcribing the text from the google bucket flac file resolves
      // and the text is stored on the transcription variable
      // console.log(`Transcription: ${transcription}`);
      callback(transcription);
    })
    .catch((err) => {
      console.error('ERROR:', err);
    });
  // [END speech_async_recognize_gcs]
}