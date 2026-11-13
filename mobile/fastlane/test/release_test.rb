# Run with `ruby mobile/fastlane/test/release_test.rb`. No gems or credentials.
# Execute the real lane with build/upload actions replaced by recording stubs.
require 'json'

module UI
  def self.user_error!(message)
    raise ArgumentError, message
  end
end

class ReleaseHarness
  attr_reader :lanes, :uploads, :builds

  def initialize
    @lanes, @uploads, @builds = {}, [], []
    path = File.expand_path('../Fastfile', __dir__)
    instance_eval(File.read(path), path)
  end

  def skip_docs; end
  def opt_out_usage; end
  def desc(_); end
  def platform(_); yield; end
  def lane(name, &block); @lanes[name] = block; end
  def app_store_connect_api_key(_); end
  def update_code_signing_settings(_); end
  def build_app(options); @builds << options; end
  def upload_to_testflight(options); @uploads << options; end
end

def assert(condition, message)
  raise message unless condition
end

original_env = ENV.to_h
begin
  ENV['COWORK_BUILD_NUMBER'] = '42'
  %w[ASC_API_KEY_ID ASC_API_ISSUER_ID ASC_API_KEY_P8_B64 IOS_PROFILE_APP_NAME IOS_TEAM_ID].each do |name|
    ENV[name] = 'test-placeholder'
  end
  release = ReleaseHarness.new
  { nil => 'staging', '' => 'staging', ' staging ' => 'staging',
    'prod' => 'prod', 'production' => 'prod', ' PRODUCTION ' => 'prod' }.each do |raw, expected|
    ENV['COWORK_ENV'] = raw
    assert(release.cowork_env == expected, "Wrong environment for #{raw.inspect}")
    release.lanes.fetch(:beta).call
    upload = release.uploads.last
    label = expected == 'prod' ? 'production (cowork.mindshub.ai)' : 'staging (cowork.staging.mindshub.ai)'
    assert(upload.fetch(:changelog).include?(label), "Wrong release label for #{raw.inspect}")
    assert(upload.fetch(:changelog).include?('(42)'), 'Missing build number')
    assert(upload.fetch(:skip_waiting_for_build_processing), 'Must label when the build appears')
    assert(upload.fetch(:wait_processing_timeout_duration) == 2700, 'Build appearance wait must remain bounded')
  end
  [:beta, :internal].each do |lane|
    ENV['COWORK_ENV'] = 'typo'
    before = [release.builds.length, release.uploads.length]
    begin
      release.lanes.fetch(lane).call
      raise 'Accepted an invalid environment'
    rescue ArgumentError => error
      assert(error.message.include?('COWORK_ENV'), 'Wrong validation failure')
    end
    assert(before == [release.builds.length, release.uploads.length], 'Validation happened after a build/upload')
  end
  puts 'Release environment and TestFlight labeling checks passed.'
ensure
  ENV.replace(original_env)
end
