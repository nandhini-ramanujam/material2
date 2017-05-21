import {browser, by, element, ExpectedConditions} from 'protractor';
import {screenshot} from '../../screenshot';
import {asyncSpec} from '../../util/index';


describe('button', () => {
  describe('disabling behavior', () => {
    beforeEach(() => browser.get('/button'));

    it('should prevent click handlers from executing when disabled', asyncSpec(async () => {
      element(by.id('test-button')).click();
      expect(element(by.id('click-counter')).getText()).toEqual('1');

      await browser.wait(ExpectedConditions.not(
        ExpectedConditions.presenceOf(element(by.css('div.mat-ripple-element')))));
      screenshot('clicked once');

      element(by.id('disable-toggle')).click();
      element(by.id('test-button')).click();
      expect(element(by.id('click-counter')).getText()).toEqual('1');

      await browser.wait(ExpectedConditions.not(
        ExpectedConditions.presenceOf(element(by.css('div.mat-ripple-element')))));
      screenshot('click disabled');
    }));
  });
});
