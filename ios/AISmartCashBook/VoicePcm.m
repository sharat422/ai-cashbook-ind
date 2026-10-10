#import <React/RCTEventEmitter.h>
#import <React/RCTBridgeModule.h>
#import <AVFoundation/AVFoundation.h>
#import <AudioToolbox/AudioToolbox.h>
#import <UIKit/UIKit.h>

@interface VoicePcm : RCTEventEmitter <RCTBridgeModule> {
  AudioQueueRef _queue;
  BOOL _starting;
  NSUInteger _generation;
}
- (void)receivedBuffer:(AudioQueueBufferRef)buffer queue:(AudioQueueRef)queue;
- (void)releaseMicrophone;
@end

static void Capture(void *context, AudioQueueRef queue, AudioQueueBufferRef buffer,
                    const AudioTimeStamp *time, UInt32 packets,
                    const AudioStreamPacketDescription *descriptions) {
  [(__bridge VoicePcm *)context receivedBuffer:buffer queue:queue];
}

@implementation VoicePcm
RCT_EXPORT_MODULE();
+ (BOOL)requiresMainQueueSetup { return YES; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }
- (NSArray<NSString *> *)supportedEvents { return @[@"voicePcmData", @"voicePcmError"]; }

- (void)receivedBuffer:(AudioQueueBufferRef)buffer queue:(AudioQueueRef)queue {
  if (buffer->mAudioDataByteSize > 0) {
    NSData *data = [NSData dataWithBytes:buffer->mAudioData length:buffer->mAudioDataByteSize];
    [self sendEventWithName:@"voicePcmData" body:[data base64EncodedStringWithOptions:0]];
  }
  AudioQueueEnqueueBuffer(queue, buffer, 0, NULL);
}

RCT_EXPORT_METHOD(start:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (_queue || _starting) { reject(@"BUSY", @"Microphone is already active.", nil); return; }
  _starting = YES;
  NSUInteger generation = ++_generation;
  AVAudioSession *session = AVAudioSession.sharedInstance;
  [session requestRecordPermission:^(BOOL granted) {
    dispatch_async(dispatch_get_main_queue(), ^{
      if (generation != self->_generation) { reject(@"CANCELLED", @"Recording cancelled.", nil); return; }
      self->_starting = NO;
      if (!granted) { reject(@"PERMISSION", @"Microphone permission is required.", nil); return; }
      NSError *error = nil;
      if (![session setCategory:AVAudioSessionCategoryRecord mode:AVAudioSessionModeMeasurement
                        options:AVAudioSessionCategoryOptionAllowBluetooth error:&error] ||
          ![session setActive:YES error:&error]) {
        [self releaseMicrophone];
        reject(@"MICROPHONE", @"Microphone setup failed.", error); return;
      }
      AudioStreamBasicDescription format = {0};
      format.mSampleRate = 24000;
      format.mFormatID = kAudioFormatLinearPCM;
      format.mFormatFlags = kLinearPCMFormatFlagIsSignedInteger | kLinearPCMFormatFlagIsPacked;
      format.mBytesPerPacket = 2;
      format.mFramesPerPacket = 1;
      format.mBytesPerFrame = 2;
      format.mChannelsPerFrame = 1;
      format.mBitsPerChannel = 16;
      OSStatus status = AudioQueueNewInput(&format, Capture, (__bridge void *)self, NULL, NULL, 0, &self->_queue);
      for (int i = 0; status == noErr && i < 3; i++) {
        AudioQueueBufferRef buffer;
        status = AudioQueueAllocateBuffer(self->_queue, 3840, &buffer);
        if (status == noErr) status = AudioQueueEnqueueBuffer(self->_queue, buffer, 0, NULL);
      }
      if (status == noErr) status = AudioQueueStart(self->_queue, NULL);
      if (status != noErr) {
        [self releaseMicrophone];
        reject(@"MICROPHONE", @"Microphone capture could not start.", nil); return;
      }
      [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(interrupted:)
        name:AVAudioSessionInterruptionNotification object:session];
      [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(backgrounded:)
        name:UIApplicationDidEnterBackgroundNotification object:nil];
      resolve(nil);
    });
  }];
}

- (void)interrupted:(NSNotification *)notification {
  if ([notification.userInfo[AVAudioSessionInterruptionTypeKey] unsignedIntegerValue] == AVAudioSessionInterruptionTypeBegan) {
    dispatch_async(dispatch_get_main_queue(), ^{
      [self releaseMicrophone];
      [self sendEventWithName:@"voicePcmError" body:@"Microphone capture was interrupted."];
    });
  }
}

- (void)backgrounded:(NSNotification *)notification {
  [self releaseMicrophone];
  [self sendEventWithName:@"voicePcmError" body:@"Recording stopped when the app left the foreground."];
}

- (void)releaseMicrophone {
  ++_generation;
  _starting = NO;
  [[NSNotificationCenter defaultCenter] removeObserver:self];
  if (_queue) {
    AudioQueueStop(_queue, true);
    AudioQueueDispose(_queue, true);
    _queue = NULL;
  }
  [AVAudioSession.sharedInstance setActive:NO withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation error:nil];
}

RCT_EXPORT_METHOD(stop:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  [self releaseMicrophone];
  resolve(nil);
}
- (void)invalidate { [self releaseMicrophone]; [super invalidate]; }
@end
