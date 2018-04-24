// @ts-check

const octokitRest = require('@octokit/rest');
const octokit = new octokitRest();

const storage = require('azure-storage');
const blob = storage.createBlobService();

const OWNER = 'tc39';
const REPO = 'agendas';
const PATH = '/';

module.exports = function(context) {
  getNextAgenda(context)
    .then(agenda => {
      blob.getBlobToText('site', 'template.html', function(
        err,
        templateContents
      ) {
        /** @type Template **/
        let template = {
          'meeting-time': formatDateSpan(agenda.startDate, agenda.endDate),
          'meeting-days-left': String(daysTil(agenda.startDate)),
          'meeting-location': agenda.location,
          'meeting-url': agenda.url,
          'meeting-agenda-days-left': String(
            daysTil(
              new Date(Number(agenda.startDate) - 1000 * 60 * 60 * 24 * 10)
            )
          )
        };

        let content = applyTemplate(template, templateContents);

        blob.createBlockBlobFromText(
          'site',
          'index.html',
          content,
          { contentSettings: { contentType: 'text/html' } },
          function(err, result) {
            context.done();
          }
        );
      });
    })
    .catch(v => {
      context.log('ERROR: ' + v);
      context.done();
    });
};

/**
 * @typedef { {'meeting-time': string,'meeting-days-left': string, 'meeting-location': string, 'meeting-agenda-days-left': string, 'meeting-url': string } } Template
 */

/**
 * Applies the above template to a template string.
 * @param template { Template }
 * @param str { string }
 *
 * @returns string
 */
function applyTemplate(template, str) {
  Object.keys(template).forEach(k => {
    str = str.replace('{' + k + '}', template[k]);
  });

  return str;
}

/**
 * @param {Date} date
 */
function daysTil(date) {
  return Math.floor((Number(date) - Date.now()) / (1000 * 60 * 60 * 24));
}

/**
 * Gets the next meeting (must be either later this year or next year).
 * TODO : Likely bugged during and perhaps immediately after TC39?
 *
 * @param {*} context
 */
function getNextAgenda(context) {
  return findNextMeetingPath(context).then(v => {
    if (!v) throw new Error('Failed to get meeting agenda');

    return octokit.repos
      .getContent({ owner: OWNER, repo: REPO, path: v.path })
      .then(agendaData => {
        let contents = Buffer.from(
          agendaData.data.content,
          'base64'
        ).toString();

        return parseAgenda(context, contents, v.month);
      });
  });
}

/**
 * Gets the next meeting path and some other metadata
 *
 * @param {*} context
 * @returns { Promise<{path: string, year: number, month: number }> }
 */
function findNextMeetingPath(context) {
  let now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;

  return getYearsMonths(context, year).then(ms => {
    let nextMonths = ms.filter(m => Number(m) >= month);

    if (nextMonths.length > 0) {
      return {
        path: year + '/' + nextMonths[0] + '.md',
        year: year,
        month: Number(nextMonths[0]) - 1
      };
    }

    return getYearsMonths(context, year + 1)
      .then(ms => {
        if (ms[0]) {
          return {
            path: year + 1 + '/' + ms[0] + '.md',
            year: year + 1,
            month: Number(ms[0]) - 1
          };
        } else {
          return null;
        }
      })
      .catch(e => {
        return null;
      });
  });
}

/**
 * Gets all the meeting months for a given year
 *
 * @param {*} context
 * @param {number} year
 */
function getYearsMonths(context, year) {
  return octokit.repos
    .getContent({ owner: OWNER, repo: REPO, path: String(year) })
    .then(root => {
      return root.data
        .filter(folder => {
          return folder.name.match(/\d+\.md/);
        })
        .map(folder => folder.name.slice(0, 2));
    });
}

/**
 * @typedef {{ location: string, startDate: Date, endDate: Date, url: string }} Agenda
 */
/**
 *
 * @param {*} context
 * @param {string} contents
 * @param {number} month Month of the agenda (normally indexed, not based on 0).
 * @returns Agenda
 */
function parseAgenda(context, contents, month) {
  const dateParts = /\- \*\*Dates\*\*: (\d+)\s*-\s*(\d+)\s*(\w+)\s*(\d+)/.exec(
    contents
  );

  const location = contents.match(/\- \*\*Location\*\*: ([^\n]+)/)[1];
  const startDate = new Date(Number(dateParts[4]), month, Number(dateParts[1]));
  const endDate = new Date(Number(dateParts[4]), month, Number(dateParts[2]));
  context.log(startDate);
  context.log(endDate);
  context.log(location);
  /** @type Agenda */
  const agenda = {
    location,
    startDate,
    endDate,
    url: `https://github.com/tc39/agendas/blob/master/${startDate.getFullYear()}/${startDate.toLocaleString(
      'en-US',
      { month: '2-digit' }
    )}.md`
  };

  return agenda;
}

/**
 * Formats a start and end date like we do for meetings.
 * @param {Date} start
 * @param {Date} end
 */
function formatDateSpan(start, end) {
  return (
    start.getDate() +
    '-' +
    end.getDate() +
    ' ' +
    start.toLocaleString('en-US', { month: 'long' }) +
    ' ' +
    start.getFullYear()
  );
}
