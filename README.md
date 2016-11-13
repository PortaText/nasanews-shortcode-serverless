# About
Send NASANEWS to 32458 to get the latest breaking news from the official NASA
RSS feed at: [https://www.nasa.gov/rss/dyn/breaking_news.rss](https://www.nasa.gov/rss/dyn/breaking_news.rss).

Terms and Conditions available at: [https://www.portatext.com/terms-and-conditions/nasa-news.html](https://www.portatext.com/terms-and-conditions/nasa-news.html).

This is a completely serverless demonstration of how to combine the [PortaText](https://www.portatext.com/)
service and API with [Amazon AWS](https://aws.amazon.com/) to create an SMS service in a short code.

This service will send you at most 1 message per day with a breaking news from
NASA (and another one extra as soon as you opt-in to the service.).

# Architecture
This code uses:
 * [PortaText](https://www.portatext.com/) as the short code provider and to
 send and receive SMS.
 * Official NASA news feed at: [https://www.nasa.gov/rss/dyn/breaking_news.rss](https://www.nasa.gov/rss/dyn/breaking_news.rss).
 * [AWS Lambda](https://aws.amazon.com/lambda/) to host all the code, no servers
 needed at all.
 * [AWS CloudWatch](https://aws.amazon.com/cloudwatch/) for logs and alerts.
 * [AWS DynamoDB](https://aws.amazon.com/dynamodb/) as main DB to save latest feed data.
 * [AWS SNS](https://aws.amazon.com/sns/) to receive notifications from PortaText
 (like opt-ins, job and campaign status notifications, etc). Also to dispatch
 and handle internal events.
 * [PortaText NodeJS SDK](https://github.com/PortaText/node-sdk) to handle campaigns and send messages.
 * Google URL Shortener service ([https://goo.gl/](https://goo.gl/)) to send a short url in the SMS messages.

# License
The source code is released under Apache 2 License.

Check [LICENSE](https://github.com/PortaText/sns-lambda-example/blob/master/LICENSE) file for more information.
