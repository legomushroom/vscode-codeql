import * as React from "react";
import * as Rdom from "react-dom";
import { assertNever } from "../helpers-pure";
import {
  ResultsInfo,
  FromResultsViewMsg,
  IntoResultsViewMsg,
  RawResultsSortState,
  NavigatePathMsg,
  ResultsViewState,
  ResultsState,
  Results,
} from "../interface-types";
import { EventHandlers as EventHandlerList } from "./event-handler-list";
import { ResultTables } from "./result-tables";

/**
 * results.tsx
 * -----------
 *
 * Displaying query results.
 */

interface VsCodeApi {
  /**
   * Post message back to vscode extension.
   */
  postMessage(msg: FromResultsViewMsg): void;
}
declare const acquireVsCodeApi: () => VsCodeApi;
export const vscode = acquireVsCodeApi();

export type NavigationEvent = NavigatePathMsg;

/**
 * Event handlers to be notified of navigation events coming from outside the webview.
 */
export const onNavigation = new EventHandlerList<NavigationEvent>();

/**
 * A minimal state container for displaying results.
 */
class App extends React.Component<{}, ResultsViewState> {
  constructor(props: any) {
    super(props);
    this.state = {
      displayedResults: {
        resultsInfo: null,
        results: null,
        errorMessage: ''
      },
      nextResultsInfo: null,
      isExpectingResultsUpdate: true
    };
  }

  handleMessage(msg: IntoResultsViewMsg): void {
    switch (msg.t) {
      case 'setState':
        this.updateStateWithNewResultsInfo({
          resultsPath: msg.resultsPath,
          origResultsPaths: msg.origResultsPaths,
          sortedResultsMap: new Map(Object.entries(msg.sortedResultsMap)),
          database: msg.database,
          interpretation: msg.interpretation,
          shouldKeepOldResultsWhileRendering: msg.shouldKeepOldResultsWhileRendering,
          metadata: msg.metadata
        });

        this.loadResults();
        break;
      case 'resultsUpdating':
        this.setState({
          isExpectingResultsUpdate: true
        });
        break;
      case 'navigatePath':
        onNavigation.fire(msg);
        break;
      default:
        assertNever(msg);
    }
  }

  private updateStateWithNewResultsInfo(resultsInfo: ResultsInfo): void {
    this.setState(prevState => {
      const stateWithDisplayedResults = (displayedResults: ResultsState): ResultsViewState => ({
        displayedResults,
        isExpectingResultsUpdate: prevState.isExpectingResultsUpdate,
        nextResultsInfo: resultsInfo
      });

      if (!prevState.isExpectingResultsUpdate && resultsInfo === null) {
        // No results to display
        return stateWithDisplayedResults({
          resultsInfo: null,
          results: null,
          errorMessage: 'No results to display'
        });
      }
      if (!resultsInfo || !resultsInfo.shouldKeepOldResultsWhileRendering) {
        // Display loading message
        return stateWithDisplayedResults({
          resultsInfo: null,
          results: null,
          errorMessage: 'Loading results…'
        });
      }
      return stateWithDisplayedResults(prevState.displayedResults);
    });
  }

  private async loadResults(): Promise<void> {
    const resultsInfo = this.state.nextResultsInfo;
    if (resultsInfo === null) {
      return;
    }

    let results: Results | null = null;
    let statusText = '';
    try {
      results = {
        resultSets: await this.getResultSets(resultsInfo),
        database: resultsInfo.database,
        sortStates: this.getSortStates(resultsInfo)
      };
    }
    catch (e) {
      let errorMessage: string;
      if (e instanceof Error) {
        errorMessage = e.message;
      } else {
        errorMessage = 'Unknown error';
      }

      statusText = `Error loading results: ${errorMessage}`;
    }

    this.setState(prevState => {
      // Only set state if this results info is still current.
      if (resultsInfo !== prevState.nextResultsInfo) {
        return null;
      }
      return {
        displayedResults: {
          resultsInfo,
          results,
          errorMessage: statusText
        },
        nextResultsInfo: null,
        isExpectingResultsUpdate: false
      }
    });
  }

  private getSortStates(resultsInfo: ResultsInfo): Map<string, RawResultsSortState> {
    const entries = Array.from(resultsInfo.sortedResultsMap.entries());
    return new Map(entries.map(([key, sortedResultSetInfo]) =>
      [key, sortedResultSetInfo.sortState]));
  }

  render(): JSX.Element {
    const displayedResults = this.state.displayedResults;
    if (displayedResults.results !== null && displayedResults.resultsInfo !== null) {
      return <ResultTables rawResultSets={displayedResults.results.resultSets}
        interpretation={displayedResults.resultsInfo ? displayedResults.resultsInfo.interpretation : undefined}
        database={displayedResults.results.database}
        origResultsPaths={displayedResults.resultsInfo.origResultsPaths}
        resultsPath={displayedResults.resultsInfo.resultsPath}
        metadata={displayedResults.resultsInfo ? displayedResults.resultsInfo.metadata : undefined}
        sortStates={displayedResults.results.sortStates}
        interpretedSortState={displayedResults.resultsInfo.interpretation?.sortState}
        isLoadingNewResults={this.state.isExpectingResultsUpdate || this.state.nextResultsInfo !== null} />;
    }
    else {
      return <span>{displayedResults.errorMessage}</span>;
    }
  }

  componentDidMount(): void {
    this.vscodeMessageHandler = evt => this.handleMessage(evt.data as IntoResultsViewMsg);
    window.addEventListener('message', this.vscodeMessageHandler);
  }

  componentWillUnmount(): void {
    if (this.vscodeMessageHandler) {
      window.removeEventListener('message', this.vscodeMessageHandler);
    }
  }

  private vscodeMessageHandler: ((ev: MessageEvent) => void) | undefined = undefined;
}

Rdom.render(
  <App />,
  document.getElementById('root')
);

vscode.postMessage({ t: "resultViewLoaded" })
