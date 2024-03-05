"use server";

export const test = async (testString: string) => {
  console.log(testString);

  return "This is a server action!";
};
