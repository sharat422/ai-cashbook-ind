source 'https://rubygems.org'

# You may use http://rbenv.org/ or https://rvm.io/ to install and use this version
ruby ">= 2.6.10"

# Exclude problematic versions of cocoapods and activesupport that causes build failures.
gem 'cocoapods', '>= 1.13', '!= 1.15.0', '!= 1.15.1'
gem 'activesupport', '>= 6.1.7.5', '!= 7.1.0'
gem 'xcodeproj', '< 1.26.0'

# json 2.10 removed the `quirks_mode` option that CocoaPods' codegen path (via RN
# 0.76's `use_react_native!`) still passes, so newer json (2.10+/3.x) breaks
# `pod install` with: "Invalid `Podfile` file: unknown keyword: quirks_mode".
# There's no committed Gemfile.lock, so without this pin bundler resolves the
# latest json (e.g. 3.0.1) on every CI build and the iOS build fails at pod install.
gem 'json', '< 2.10'

# Ruby 3.4+ (Codemagic builders use Ruby 4.x) dropped `nkf`/`kconv` from the
# default gems. CocoaPods' CFPropertyList does `require 'kconv'`, so it must be
# provided explicitly or `pod install` crashes with "cannot load such file -- kconv".
gem 'nkf'
