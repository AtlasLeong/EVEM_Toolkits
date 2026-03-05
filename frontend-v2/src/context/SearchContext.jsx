import React, { createContext, useState, useContext } from "react";

const SearchContext = createContext();

export function SearchProvider({ children }) {
  const [searchState, setSearchState] = useState({
    jumpPathStart: null,
    jumpPathEnd: null,
    jumpRange: 4.9,
    inHighSecurity: true,
    pathData: [],
  });

  const updateSearchState = (newState) => {
    setSearchState((prevState) => ({ ...prevState, ...newState }));
  };

  return (
    <SearchContext.Provider value={{ searchState, updateSearchState }}>
      {children}
    </SearchContext.Provider>
  );
}

export function useSearchContext() {
  return useContext(SearchContext);
}
